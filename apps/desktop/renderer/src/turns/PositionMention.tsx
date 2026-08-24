import { AtSign } from "lucide-react";
import type { PositionMentionOption } from "./types";

export interface PositionMentionProps {
  positions: PositionMentionOption[];
  value: string | null;
  disabled?: boolean;
  onChange: (positionId: string) => void;
}

/** Position addressability control. Options come only from the applied org tree. */
export function PositionMention({
  positions,
  value,
  disabled = false,
  onChange,
}: PositionMentionProps) {
  return (
    <label className="owb-position-mention">
      <span className="owb-turn-control__label">对话岗位</span>
      <span className="owb-position-mention__field">
        <AtSign aria-hidden="true" size={14} />
        <select
          aria-label="选择对话岗位"
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        >
          <option value="">选择岗位</option>
          {positions.map((position) => (
            <option key={position.id} value={position.id}>
              {position.name} · {position.id}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
