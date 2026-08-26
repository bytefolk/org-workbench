import { Select as AntSelect } from "antd";
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
        <AntSelect
          aria-label="选择对话岗位"
          value={value ?? undefined}
          placeholder="选择岗位"
          disabled={disabled}
          onChange={(next) => {
            if (next) onChange(next);
          }}
          options={positions.map((position) => ({
            value: position.id,
            label: `${position.name} · ${position.id}`,
          }))}
        />
      </span>
    </label>
  );
}
