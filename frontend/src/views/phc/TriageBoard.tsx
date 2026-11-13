import { useState } from "react";
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useTranslation } from "@/i18n";
import { GripVertical } from "lucide-react";
import type { StaffReferral } from "@/controllers/staff/types";
import { api } from "@/services/api/client";
import { UrgencyPill } from "@/views/components/app/risk";
import { cn } from "@/lib/cx";

const LANES: { id: StaffReferral["lane"]; label: string; hint: string }[] = [
  { id: "urgent", label: "Urgent", hint: "Today" },
  { id: "this_week", label: "This week", hint: "Book within 7 days" },
  { id: "monitor", label: "Monitor", hint: "Recheck at next visit" },
];

/** Drag a case between lanes: the medical officer's call overrides the engine's suggested lane. */
export function TriageBoard({ referrals, canEdit, onOpen, onChanged }: {
  referrals: StaffReferral[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onChanged: (id: string, lane: StaffReferral["lane"]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [error, setError] = useState<string | null>(null);

  async function onDragEnd(e: DragEndEvent) {
    const lane = e.over?.id as StaffReferral["lane"] | undefined;
    const id = String(e.active.id);
    const r = referrals.find((x) => x.id === id);
    if (!lane || !r || r.lane === lane) return;
    onChanged(id, lane); // optimistic
    try {
      await api(`/referrals/${id}/lane`, { method: "PATCH", json: { lane } });
      setError(null);
    } catch {
      onChanged(id, r.lane);
      setError("Could not move the case. Check the connection.");
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {error && <p className="mb-2 font-display text-sm text-signal">{error}</p>}
      <div className="grid gap-3 lg:grid-cols-3">
        {LANES.map((lane) => (
          <Lane key={lane.id} lane={lane} items={referrals.filter((r) => r.lane === lane.id)} canEdit={canEdit} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}

function Lane({ lane, items, canEdit, onOpen }: { lane: (typeof LANES)[number]; items: StaffReferral[]; canEdit: boolean; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  return (
    <section ref={setNodeRef} className={cn("flex min-h-48 flex-col rounded-3xl border bg-surface p-3 transition-colors", isOver ? "border-crimson bg-blood/15" : "border-line")}>
      <header className="mb-2 flex items-baseline justify-between px-1">
        <h3 className="font-display font-semibold">{lane.label} <span className="text-mute">· {items.length}</span></h3>
        <span className="font-display text-xs text-mute">{lane.hint}</span>
      </header>
      <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
        {items.slice(0, 40).map((r) => <Card key={r.id} r={r} canEdit={canEdit} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

function Card({ r, canEdit, onOpen }: { r: StaffReferral; canEdit: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: r.id, disabled: !canEdit });
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-2xl border bg-raised p-3", isDragging ? "z-20 border-crimson shadow-2xl" : "border-line", r.overdue && "border-warn/70")}
    >
      <div className="flex items-start gap-2">
        {canEdit && (
          <button type="button" {...listeners} {...attributes} aria-label="Drag to another lane" className="mt-0.5 cursor-grab text-mute active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-display text-[15px] font-semibold">{r.person.name ?? `${r.person.sex}, ${r.person.age}`}</span>
            <span className="font-display text-xs text-mute">P{r.priority}</span>
          </span>
          <span className="mt-0.5 block truncate font-serif text-[13px] text-mute">
            {r.person.village} · {r.reasons.slice(0, 2).map((c) => t(`flags.${c}`)).join(", ")}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <UrgencyPill urgency={r.urgency} />
            <span className="rounded-full bg-ink/60 px-2 py-0.5 font-display text-[11px] text-paper/80">{r.status}</span>
            {r.overdue && <span className="pulse-amber rounded-full bg-warn/20 px-2 py-0.5 font-display text-[11px] text-warn">overdue</span>}
          </span>
        </button>
      </div>
    </li>
  );
}
