const fs = require('fs');
const path = require('path');

// Load params.js
// Mock window and other browser globals needed by params.js
const mockWindow = { params: null };
global.window = mockWindow;

const paramsPath = path.resolve(__dirname, '../js/params.js');
require(paramsPath);

const params = mockWindow.params;

if (!params) {
    console.error('Failed to load params from js/params.js');
    process.exit(1);
}

// Build lookup maps
const buffMap = new Map<number, any>();
params.buildingBuffs.forEach((b: any) => buffMap.set(b.guid, b));

const factoryMap = new Map<number, any>();
params.factories.forEach((f: any) => factoryMap.set(f.guid, f));

const productMap = new Map<number, any>();
params.products.forEach((p: any) => productMap.set(p.guid, p));

const effectMap = new Map<number, any>();
params.effects.forEach((e: any) => effectMap.set(e.guid, e));

// Graph nodes and edges
type NodeType = 'PRODUCT' | 'FACTORY';
interface Node {
    guid: number;
    type: NodeType;
    name: string;
}

interface Edge {
    from: number;
    to: number;
    type: 'PRODUCT_TO_PRODUCER' | 'PRODUCER_TO_INPUT' | 'EXTRA_GOOD' | 'PRODUCT_SOURCED_FROM';
    metadata?: any;
}

const nodes = new Map<number, Node>();
const edges: Edge[] = [];

// Helper: safely resolve a localised name from either a locaText object or a plain name field
function resolveName(asset: any): string {
    return asset?.locaText?.english ?? asset?.name ?? String(asset?.guid ?? '?');
}

// Add nodes
productMap.forEach(p => nodes.set(p.guid, { guid: p.guid, type: 'PRODUCT', name: resolveName(p) }));
factoryMap.forEach(f => nodes.set(f.guid, { guid: f.guid, type: 'FACTORY', name: resolveName(f) }));

// Pre-compute self-effecting extra good contributions per factory.
// These are annotated on the PRODUCT_TO_PRODUCER edge rather than creating self-loop edges.
// extraGoodFactor = 1 + Σ(amount / additionalOutputCycle) when all targeting effects are active.
const selfEffectingByFactory = new Map<number, Array<{ effectGuid: number; factorContrib: number }>>();
effectMap.forEach(e => {
    if (!e.targets || e.targets.length === 0) return;
    e.buffs.forEach(buffGuid => {
        const buff = buffMap.get(buffGuid);
        if (!buff || !buff.additionalOutputs) return;
        buff.additionalOutputs.forEach((ao: any) => {
            if (ao.forceProductSameAsFactoryOutput) {
                const contrib = ao.amount / ao.additionalOutputCycle;
                e.targets.forEach((factoryGuid: number) => {
                    if (!selfEffectingByFactory.has(factoryGuid)) selfEffectingByFactory.set(factoryGuid, []);
                    selfEffectingByFactory.get(factoryGuid)!.push({ effectGuid: e.guid, factorContrib: contrib });
                });
            }
        });
    });
});

// Add static edges
factoryMap.forEach(f => {
    // FACTORY -> INPUT PRODUCT
    if (f.inputs) {
        f.inputs.forEach(input => {
            edges.push({
                from: f.guid,
                to: input.product,
                type: 'PRODUCER_TO_INPUT'
            });
        });
    }

    // PRODUCT -> PRODUCER (FACTORY)
    if (f.outputs && f.outputs.length > 0) {
        const output = f.outputs[0];
        const selfEffecting = selfEffectingByFactory.get(f.guid) ?? [];
        const extraGoodFactor = 1 + selfEffecting.reduce((s, e) => s + e.factorContrib, 0);
        edges.push({
            from: output.product,
            to: f.guid,
            type: 'PRODUCT_TO_PRODUCER',
            metadata: {
                outputAmount: output.amount,
                associatedRegions: f.associatedRegions,
                extraGoodFactor,          // effective output multiplier when all self-effecting effects are active
                selfEffectingEffects: selfEffecting
            }
        });
    }
});

// Add conditional edges (Effects -> Buffs -> Extra Goods)
effectMap.forEach(e => {
    if (!e.targets || e.targets.length === 0) return;

    e.buffs.forEach(buffGuid => {
        const buff = buffMap.get(buffGuid);
        if (!buff || !buff.additionalOutputs) return;

        buff.additionalOutputs.forEach(ao => {
            if (ao.forceProductSameAsFactoryOutput) {
                // Self-effecting: metadata already handled conceptually, 
                // but we could annotate edges here if we wanted to be precise.
                // The plan says: Do NOT add EXTRA_GOOD or PRODUCT_SOURCED_FROM edges.
            } else {
                // For each target factory
                e.targets!.forEach(factoryGuid => {
                    const factory = factoryMap.get(factoryGuid);
                    if (!factory) return;

                    // EXTRA_GOOD: Factory -> Product
                    edges.push({
                        from: factoryGuid,
                        to: ao.product,
                        type: 'EXTRA_GOOD',
                        metadata: {
                            effectGuid: e.guid,
                            buffGuid: buff.guid
                        }
                    });

                    // PRODUCT_SOURCED_FROM: ExtraGoodProduct -> PrimaryOutputProduct
                    if (factory.outputs && factory.outputs.length > 0) {
                        edges.push({
                            from: ao.product,
                            to: factory.outputs[0].product,
                            type: 'PRODUCT_SOURCED_FROM',
                            metadata: {
                                factoryGuid: factory.guid
                            }
                        });
                    }
                });
            }
        });
    });
});

// Algorithms
const adj = new Map<number, number[]>();
nodes.forEach((_, guid) => adj.set(guid, []));
edges.forEach(edge => adj.get(edge.from)!.push(edge.to));

// SCCs (Tarjan's)
let index = 0;
const stack: number[] = [];
const onStack = new Set<number>();
const indices = new Map<number, number>();
const lowlink = new Map<number, number>();
const sccs: number[][] = [];

function strongConnect(v: number) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) || [];
    for (const w of neighbors) {
        if (!indices.has(w)) {
            strongConnect(w);
            lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
        }
    }

    if (lowlink.get(v) === indices.get(v)) {
        const scc: number[] = [];
        let w;
        do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
        } while (w !== v);
        sccs.push(scc);
    }
}

nodes.forEach((_, guid) => {
    if (!indices.has(guid)) {
        strongConnect(guid);
    }
});

// Cycle detection (using SCCs and back-edges)
const cycles: any[] = [];
sccs.filter(scc => scc.length > 1).forEach(scc => {
    cycles.push({
        nodes: scc,
        names: scc.map(guid => nodes.get(guid)!.name)
    });
});

// Diamond detection
// For each product P, find if there are multiple paths from a common ancestor
const diamonds: any[] = [];
productMap.forEach(p => {
    const guid = p.guid;
    const incoming = edges.filter(e => e.to === guid && (e.type === 'PRODUCT_TO_PRODUCER' || e.type === 'PRODUCT_SOURCED_FROM' || e.type === 'EXTRA_GOOD'));
    if (incoming.length >= 2) {
        // Simple heuristic: if a product is an extra good from multiple sources, or multiple factories produce it.
        // The plan specifically mentions obsidian diamond.
        const paths: any[] = [];
        
        incoming.forEach(edge => {
            const supplier = edge.from;
            paths.push({ supplier, type: edge.type });
        });
        
        diamonds.push({
            productGuid: guid,
            name: p.locaText.english,
            supplierPaths: paths
        });
    }
});

// Hub nodes
const inDegree = new Map<number, number>();
const outDegree = new Map<number, number>();
nodes.forEach((_, guid) => {
    inDegree.set(guid, 0);
    outDegree.set(guid, 0);
});
edges.forEach(edge => {
    outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
});

const hubs = Array.from(nodes.values()).map(n => ({
    guid: n.guid,
    name: n.name,
    type: n.type.toLowerCase(),
    inDegree: inDegree.get(n.guid) || 0,
    outDegree: outDegree.get(n.guid) || 0,
    total: (inDegree.get(n.guid) || 0) + (outDegree.get(n.guid) || 0)
})).sort((a, b) => b.total - a.total).slice(0, 10);

// Output
const result = {
    stats: {
        productCount: productMap.size,
        factoryCount: factoryMap.size,
        edgeCount: edges.length
    },
    cycles,
    sccs: sccs.map(scc => ({ nodes: scc, size: scc.length })),
    diamonds,
    hubs
};

const distDir = path.resolve(__dirname, '../dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}
fs.writeFileSync(path.join(distDir, 'demand-graph.json'), JSON.stringify(result, null, 2));

console.log('Graph Analysis Summary:');
console.log(`Products: ${result.stats.productCount}`);
console.log(`Factories: ${result.stats.factoryCount}`);
console.log(`Edges: ${result.stats.edgeCount}`);
console.log(`SCCs with >1 node: ${cycles.length}`);
console.log(`Diamonds detected: ${diamonds.length}`);
console.log('\nTop Hubs:');
hubs.forEach(h => console.log(`- ${h.name} (${h.type}): In=${h.inDegree}, Out=${h.outDegree}`));

// Verify expected findings
const coalResinWoodCycle = cycles.find(c => 
    c.names.includes('Coal') && c.names.includes('Resin') && c.names.includes('Wood')
);
if (coalResinWoodCycle) {
    console.log('\n✓ Found Coal -> Resin -> Wood cycle');
} else {
    console.log('\n✗ Coal -> Resin -> Wood cycle NOT found');
}

const obsidianDiamond = diamonds.find(d => d.name === 'Obsidian');
if (obsidianDiamond) {
    console.log('✓ Found Obsidian diamond');
} else {
    console.log('✗ Obsidian diamond NOT found');
}
