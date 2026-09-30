import { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, addEdge, applyNodeChanges, applyEdgeChanges,
  Handle, Position,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X, Plus, Trash2 } from "lucide-react";
import { NODE_TYPES, nodeDisponivel } from "../../../exhibitions/nodeRegistry";
import type { NodeTypeSpec, CapacidadesAmbiente } from "../../../exhibitions/nodeRegistry";
import type { GraphConnection, NodeGraph, NodeTypeId } from "../../../exhibitions/types";

function graphToFlow(graph: NodeGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    position: { x: n.pos[0], y: n.pos[1] },
    data: { nodeType: n.type, params: n.params },
    type: "sensusNode",
  }));
  const edges: Edge[] = graph.connections.map((c, i) => ({
    id: `e${i}-${c.from[0]}-${c.from[1]}-${c.to[0]}-${c.to[1]}`,
    source: c.from[0], sourceHandle: c.from[1],
    target: c.to[0], targetHandle: c.to[1],
  }));
  return { nodes, edges };
}

function flowToGraph(nodes: Node[], edges: Edge[]): NodeGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType as NodeTypeId,
      params: n.data.params as Record<string, any>,
      pos: [n.position.x, n.position.y] as [number, number],
    })),
    connections: edges.map((e) => ({
      from: [e.source, e.sourceHandle || "out"],
      to: [e.target, e.targetHandle || "in"],
    })) as GraphConnection[],
  };
}

// Cor por categoria — dá leitura imediata do tipo de node sem depender de ícones.
const COR_CATEGORIA: Record<NodeTypeSpec["category"], string> = {
  "Sensor": "#8ab8ff",
  "Constante": "#c9ceda",
  "Matemática": "#7c67ff",
  "Lógica": "#a6e8d9",
  "Utilitário": "#c9ceda",
  "Output Visual": "#ff9d7c",
  "Output Áudio": "#ffd97c",
};

function SensusNode({ id, data }: { id: string; data: any }) {
  const spec = NODE_TYPES[data.nodeType as NodeTypeId];
  if (!spec) {
    return (
      <div className="rounded-md border border-rose-500 bg-rose-950 p-2 text-[10px] text-rose-200">
        Tipo desconhecido: {data.nodeType}
      </div>
    );
  }
  const inputPorts = Object.keys(spec.inputs);
  const outputPorts = Object.keys(spec.outputs);
  const cor = COR_CATEGORIA[spec.category] ?? "#7c67ff";

  return (
    // Sem `overflow-hidden`: ele cortava os handles, que ficam a meio caminho
    // fora da caixa. Invisíveis e inclicáveis, era isso que impedia as ligações.
    <div
      className="min-w-[190px] rounded-md shadow-xl"
      style={{ background: "#111d3b", border: "1px solid rgba(255,255,255,0.10)" }}
    >
      <div
        className="flex items-center justify-between gap-2 rounded-t-md px-2.5 py-1.5"
        style={{ background: "rgba(255,255,255,0.04)", borderBottom: `2px solid ${cor}` }}
      >
        <span className="text-[11px] font-medium" style={{ color: "#f8f8fa" }}>
          {spec.label}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); data.onDelete(id); }}
          title="Apagar node"
          aria-label="Apagar node"
          className="nodrag flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-rose-500/25"
          style={{ color: "#c9ceda" }}
        >
          <X className="size-3" />
        </button>
      </div>

      <div className="flex flex-col gap-1 px-2.5 py-2">
        {inputPorts.map((port) => (
          <div key={port} className="relative flex items-center py-0.5 text-[10px]" style={{ color: "#c9ceda" }}>
            <Handle
              type="target"
              position={Position.Left}
              id={port}
              style={{ background: cor, width: 13, height: 13, left: -7, border: "2px solid #0b1020", borderRadius: 99 }}
            />
            {port}
          </div>
        ))}

        {spec.paramFields.map((f) => (
          <label
            key={f.key}
            className="flex items-center justify-between gap-2 py-0.5 text-[10px]"
            style={{ color: "#c9ceda" }}
          >
            <span className="truncate">{f.label}</span>
            {f.kind === "select" ? (
              <select
                className="nodrag w-24 rounded px-1 py-0.5 text-[10px]"
                style={{ background: "#080b16", color: "#f8f8fa", border: "1px solid rgba(255,255,255,0.12)" }}
                value={data.params[f.key] ?? f.default}
                onChange={(e) => data.onParamChange(id, f.key, e.target.value)}
              >
                {f.options!.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
              </select>
            ) : f.kind === "checkbox" ? (
              <input
                type="checkbox"
                className="nodrag"
                checked={!!(data.params[f.key] ?? f.default)}
                onChange={(e) => data.onParamChange(id, f.key, e.target.checked)}
              />
            ) : f.kind === "color" ? (
              <input
                type="color"
                className="nodrag h-5 w-10 rounded"
                style={{ background: "#080b16", border: "1px solid rgba(255,255,255,0.12)" }}
                value={data.params[f.key] ?? f.default}
                onChange={(e) => data.onParamChange(id, f.key, e.target.value)}
              />
            ) : (
              <input
                type={f.kind === "number" ? "number" : "text"}
                className="nodrag w-24 rounded px-1 py-0.5 text-[10px]"
                style={{ background: "#080b16", color: "#f8f8fa", border: "1px solid rgba(255,255,255,0.12)" }}
                value={data.params[f.key] ?? f.default}
                onChange={(e) => data.onParamChange(id, f.key, f.kind === "number" ? parseFloat(e.target.value) : e.target.value)}
              />
            )}
          </label>
        ))}

        {outputPorts.map((port) => (
          <div
            key={port}
            className="relative flex items-center justify-end py-0.5 text-[10px]"
            style={{ color: "#c9ceda" }}
          >
            {port}
            <Handle
              type="source"
              position={Position.Right}
              id={port}
              style={{ background: cor, width: 13, height: 13, right: -7, border: "2px solid #0b1020", borderRadius: 99 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const NODE_RENDER_TYPES = { sensusNode: SensusNode };

export function NodeGraphEditor({
  graph,
  onChange,
  capacidades,
}: {
  graph: NodeGraph;
  onChange: (g: NodeGraph) => void;
  /** O que o ambiente ativo consegue consumir. Filtra a paleta. */
  capacidades?: CapacidadesAmbiente;
}) {
  const initial = useMemo(() => graphToFlow(graph), [graph]);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const commitTimer = useRef<any>(null);
  const nodeIdCounter = useRef(nodes.length);

  // Tipos agrupados por categoria — 50 botões soltos eram impossíveis de percorrer.
  const porCategoria = useMemo(() => {
    const grupos = new Map<string, NodeTypeId[]>();
    const cap = capacidades ?? { streamdiffusion: true, musica: true, profundidade3d: true };
    (Object.keys(NODE_TYPES) as NodeTypeId[]).forEach((t) => {
      if (!nodeDisponivel(t, cap)) return;
      const cat = NODE_TYPES[t].category;
      if (!grupos.has(cat)) grupos.set(cat, []);
      grupos.get(cat)!.push(t);
    });
    return Array.from(grupos.entries());
  }, [capacidades]);

  const commit = useCallback((n: Node[], e: Edge[]) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onChange(flowToGraph(n, e)), 300);
  }, [onChange]);

  const onParamChange = useCallback((nodeId: string, key: string, value: any) => {
    setNodes((prev) => {
      // `data` do React Flow é genérico e `params` chega como unknown, que não
      // se pode espalhar. O formato real está garantido pelo graphToFlow.
      const next = prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, params: { ...(n.data.params as Record<string, any>), [key]: value } } }
          : n,
      );
      commit(next, edges);
      return next;
    });
  }, [edges, commit]);

  // Apagar um node remove também as ligações que lhe tocam — sem isto o grafo
  // ficava com ligações órfãs e o avaliador do engine rejeitava-o inteiro.
  const onDelete = useCallback((nodeId: string) => {
    setNodes((prevNodes) => {
      const nextNodes = prevNodes.filter((n) => n.id !== nodeId);
      setEdges((prevEdges) => {
        const nextEdges = prevEdges.filter((e) => e.source !== nodeId && e.target !== nodeId);
        commit(nextNodes, nextEdges);
        return nextEdges;
      });
      return nextNodes;
    });
  }, [commit]);

  const limparTudo = useCallback(() => {
    setNodes([]);
    setEdges([]);
    commit([], []);
  }, [commit]);

  const nodesWithHandlers = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, onParamChange, onDelete } })),
    [nodes, onParamChange, onDelete]
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      commit(next, edges);
      return next;
    });
  }, [edges, commit]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => {
      const next = applyEdgeChanges(changes, prev);
      commit(nodes, next);
      return next;
    });
  }, [nodes, commit]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((prev) => {
      const next = addEdge(conn, prev);
      commit(nodes, next);
      return next;
    });
  }, [nodes, commit]);

  const addNode = useCallback((type: NodeTypeId) => {
    const spec = NODE_TYPES[type];
    const params: Record<string, any> = {};
    spec.paramFields.forEach((f) => { params[f.key] = f.default; });
    nodeIdCounter.current += 1;
    const novo: Node = {
      id: `${type}-${nodeIdCounter.current}`,
      type: "sensusNode",
      position: { x: 80 + (nodeIdCounter.current % 5) * 210, y: 80 + Math.floor(nodeIdCounter.current / 5) * 150 },
      data: { nodeType: type, params },
    };
    setNodes((prev) => {
      const next = [...prev, novo];
      commit(next, edges);
      return next;
    });
    setPaletaAberta(false);
  }, [edges, commit]);

  return (
    <div className="relative flex h-[520px] flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPaletaAberta((p) => !p)}
          className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] transition-opacity hover:opacity-90"
          style={{ background: "var(--brand-primary, #7c67ff)", color: "#f8f8fa", fontWeight: 500 }}
        >
          <Plus className="size-3.5" />
          Adicionar node
        </button>

        <span className="text-[11px]" style={{ color: "var(--brand-text-muted, #c9ceda)", opacity: 0.7 }}>
          {nodes.length} {nodes.length === 1 ? "node" : "nodes"} · {edges.length} {edges.length === 1 ? "ligação" : "ligações"}
        </span>

        {nodes.length > 0 && (
          <button
            type="button"
            onClick={limparTudo}
            className="ml-auto flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] transition-colors hover:bg-rose-500/20"
            style={{ color: "var(--brand-text-muted, #c9ceda)", border: "1px solid rgba(255,255,255,0.10)" }}
          >
            <Trash2 className="size-3" />
            Limpar tudo
          </button>
        )}
      </div>

      {paletaAberta && (
        <div
          className="absolute left-0 top-10 z-50 max-h-[380px] w-[380px] overflow-y-auto rounded-sm p-3 shadow-2xl"
          style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          {porCategoria.map(([categoria, tipos]) => (
            <div key={categoria} className="mb-3 last:mb-0">
              <div
                className="mb-1.5 flex items-center gap-2 text-[10px]"
                style={{ color: "#c9ceda", opacity: 0.65 }}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: COR_CATEGORIA[categoria as NodeTypeSpec["category"]] ?? "#7c67ff" }}
                />
                {categoria}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tipos.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addNode(t)}
                    className="rounded-sm px-2 py-1 text-[10px] transition-colors"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      color: "#f8f8fa",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {NODE_TYPES[t].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="flex-1 overflow-hidden rounded-sm"
        style={{ border: "1px solid rgba(255,255,255,0.10)" }}
      >
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edges}
          nodeTypes={NODE_RENDER_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          deleteKeyCode={["Delete", "Backspace"]}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.10)" gap={18} />
          {/* Os botões do React Flow vêm com fundo branco e ícone branco — no
              tema escuro ficavam invisíveis. O minimapa foi removido: ocupava um
              canto do editor e mostrava manchas de cor que não ajudam a ler o
              grafo. */}
          <Controls showInteractive={false} className="sensus-node-controls" />
        </ReactFlow>
      </div>
    </div>
  );
}
