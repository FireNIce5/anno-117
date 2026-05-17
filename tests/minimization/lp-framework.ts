const solver = require('javascript-lp-solver');

export interface LpInput {
  params: any;
  sessionGuid: number;
  demands: Array<{ productGuid: number; amount: number }>;
  activeEffects: Array<{ effectGuid: number; scaling: number }>;
  /** Module-based buffs applied to specific factories (modules are not effects in params.js) */
  activeModules?: Array<{ factoryGuid: number; buffGuids: number[] }>;
}

export interface LpSolution {
  feasible: boolean;
  throughputs: Map<number, number>;   // factoryGuid -> throughput (units/min)
  boosts: Map<number, number>;        // factoryGuid -> boost multiplier
  objective: number;
}

export function buildAndSolve(input: LpInput): LpSolution {
  const { params, sessionGuid, demands, activeEffects, activeModules = [] } = input;
  
  // 1. Setup lookup maps
  const factoryMap = new Map<number, any>();
  params.factories.forEach((f: any) => factoryMap.set(f.guid, f));
  
  const buffMap = new Map<number, any>();
  params.buildingBuffs.forEach((b: any) => buffMap.set(b.guid, b));
  
  const effectMap = new Map<number, any>();
  params.effects.forEach((e: any) => effectMap.set(e.guid, e));

  // Find session region
  const session = params.sessions.find((s: any) => s.guid === sessionGuid);
  if (!session) throw new Error(`Session ${sessionGuid} not found`);
  const regionGuid = session.region;
  const region = params.regions.find((r: any) => r.guid === regionGuid);
  if (!region) throw new Error(`Region ${regionGuid} not found`);
  const regionId = region.id;

  // 2. Identify decision variables (factories in the right region)
  const factories = params.factories.filter((f: any) => 
    f.associatedRegions.includes(regionId)
  );

  const model: any = {
    optimize: "objective",
    opType: "minimize",
    constraints: {},
    variables: {}
  };

  // 3. Pre-calculate boosts and extraGoodFactors for each factory
  const factoryBoosts = new Map<number, number>();
  const factoryExtraGoodFactors = new Map<number, number>();

  factories.forEach((f: any) => {
    let baseBoost = 100;
    let multiplierBoost = 100;

    // Active effects targeting this factory explicitly
    activeEffects.forEach(ae => {
        const effect = effectMap.get(ae.effectGuid);
        if (effect && effect.targets && effect.targets.includes(f.guid)) {
            effect.buffs.forEach((buffGuid: number) => {
                const buff = buffMap.get(buffGuid);
                if (buff) {
                    baseBoost += (buff.baseProductivityUpgrade || 0) * ae.scaling;
                    multiplierBoost += (buff.productivityUpgrade || 0) * ae.scaling;
                }
            });
        }
    });

    // Active modules on this factory (scaling = 1 when checked)
    activeModules.forEach(am => {
        if (am.factoryGuid === f.guid) {
            am.buffGuids.forEach(buffGuid => {
                const buff = buffMap.get(buffGuid);
                if (buff) {
                    baseBoost += buff.baseProductivityUpgrade || 0;
                    multiplierBoost += buff.productivityUpgrade || 0;
                }
            });
        }
    });

    const totalBoost = (baseBoost * multiplierBoost) / 10000;
    factoryBoosts.set(f.guid, totalBoost);

    // Self-effecting extra goods boost the primary output coefficient
    let extraGoodFactor = 1.0;
    activeEffects.forEach(ae => {
        const effect = effectMap.get(ae.effectGuid);
        if (effect && effect.targets && effect.targets.includes(f.guid)) {
            effect.buffs.forEach((buffGuid: number) => {
                const buff = buffMap.get(buffGuid);
                if (buff && buff.additionalOutputs) {
                    buff.additionalOutputs.forEach((ao: any) => {
                        if (ao.forceProductSameAsFactoryOutput) {
                            extraGoodFactor += (ae.scaling * ao.amount) / ao.additionalOutputCycle;
                        }
                    });
                }
            });
        }
    });
    activeModules.forEach(am => {
        if (am.factoryGuid === f.guid) {
            am.buffGuids.forEach(buffGuid => {
                const buff = buffMap.get(buffGuid);
                if (buff && buff.additionalOutputs) {
                    buff.additionalOutputs.forEach((ao: any) => {
                        if (ao.forceProductSameAsFactoryOutput) {
                            extraGoodFactor += ao.amount / ao.additionalOutputCycle;
                        }
                    });
                }
            });
        }
    });
    factoryExtraGoodFactors.set(f.guid, extraGoodFactor);

    // Decision variable for factory throughput (buildings count)
    const varName = `t_${f.guid}`;
    model.variables[varName] = { objective: 1 };
  });

  // 4. Add constraints for each product
  const productGuids = new Set<number>();
  params.products.forEach((p: any) => productGuids.add(p.guid));

  productGuids.forEach(pGuid => {
    const constraints: any = {};
    let hasConstraint = false;

    // Production (Primary)
    factories.forEach((f: any) => {
        const boost = factoryBoosts.get(f.guid)!;
        const cyclesPerMinPerBuilding = (boost * 60) / f.cycleTime;

        if (f.outputs && f.outputs[0].product === pGuid) {
            const varName = `t_${f.guid}`;
            const extraFactor = factoryExtraGoodFactors.get(f.guid)!;
            const rate = f.outputs[0].amount * cyclesPerMinPerBuilding * extraFactor;
            constraints[varName] = (constraints[varName] || 0) + rate;
            hasConstraint = true;
        }

        // Extra goods (Non-self-effecting) from active effects
        activeEffects.forEach(ae => {
            const effect = effectMap.get(ae.effectGuid);
            if (effect && effect.targets && effect.targets.includes(f.guid)) {
                effect.buffs.forEach((buffGuid: number) => {
                    const buff = buffMap.get(buffGuid);
                    if (buff && buff.additionalOutputs) {
                        buff.additionalOutputs.forEach((ao: any) => {
                            if (!ao.forceProductSameAsFactoryOutput && ao.product === pGuid) {
                                const varName = `t_${f.guid}`;
                                const rate = cyclesPerMinPerBuilding * (ae.scaling * ao.amount) / ao.additionalOutputCycle;
                                constraints[varName] = (constraints[varName] || 0) + rate;
                                hasConstraint = true;
                            }
                        });
                    }
                });
            }
        });

        // Extra goods (Non-self-effecting) from active modules
        activeModules.forEach(am => {
            if (am.factoryGuid !== f.guid) return;
            am.buffGuids.forEach(buffGuid => {
                const buff = buffMap.get(buffGuid);
                if (buff && buff.additionalOutputs) {
                    buff.additionalOutputs.forEach((ao: any) => {
                        if (!ao.forceProductSameAsFactoryOutput && ao.product === pGuid) {
                            const varName = `t_${f.guid}`;
                            const rate = cyclesPerMinPerBuilding * ao.amount / ao.additionalOutputCycle;
                            constraints[varName] = (constraints[varName] || 0) + rate;
                            hasConstraint = true;
                        }
                    });
                }
            });
        });

        // Inputs (Consumption)
        if (f.inputs) {
            f.inputs.forEach((input: any) => {
                if (input.product === pGuid) {
                    const varName = `t_${f.guid}`;
                    const rate = input.amount * cyclesPerMinPerBuilding;
                    constraints[varName] = (constraints[varName] || 0) - rate;
                    hasConstraint = true;
                }
            });
        }
    });

    if (hasConstraint) {
        const demand = demands.find(d => d.productGuid === pGuid);
        const minAmount = demand ? demand.amount : 0;
        
        const constrName = `p_${pGuid}`;
        model.constraints[constrName] = { min: minAmount };
        
        // Apply coefficients to variables
        for (const [varName, coeff] of Object.entries(constraints)) {
            model.variables[varName][constrName] = coeff;
        }
    }
  });

  // 5. Solve
  const results = solver.Solve(model);
  
  if (results.feasible) {
    console.log(`[LP] Solution found for session ${sessionGuid} (Region: ${regionId}):`);
    factories.forEach((f: any) => {
        const buildings = results[`t_${f.guid}`] || 0;
        if (buildings > 1e-6) {
            const boost = factoryBoosts.get(f.guid) || 1;
            const throughput = (buildings * boost * 60) / f.cycleTime;
            console.log(`  - Factory ${f.guid} (${f.name}): buildings=${buildings.toFixed(4)}, throughput=${throughput.toFixed(4)} cycles/min, boost=${(boost*100).toFixed(0)}%`);
        }
    });
    for (const pGuid of productGuids) {
        const demand = demands.find(d => d.productGuid === pGuid);
        if (demand && demand.amount > 1e-6) {
            console.log(`  - Product ${pGuid}: demand=${demand.amount.toFixed(4)} units/min`);
        }
    }
  } else {
    console.log(`[LP] No feasible solution found for session ${sessionGuid} (Region: ${regionId})`);
  }

  const throughputs = new Map<number, number>();
  factories.forEach((f: any) => {
    const buildings = results[`t_${f.guid}`] || 0;
    const boost = factoryBoosts.get(f.guid) || 1;
    const throughput = (buildings * boost * 60) / f.cycleTime;
    throughputs.set(f.guid, throughput);
  });

  return {
    feasible: results.feasible,
    throughputs,
    boosts: factoryBoosts,
    objective: results.result
  };
}
