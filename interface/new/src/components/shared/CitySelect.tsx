import { LIBERIA_CITIES } from '../../utils/liberia';

interface CitySelectProps {
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Liberia city dropdown — pre-filled list of Liberian cities.
 * If the current value is not in the list, it is rendered as an extra option
 * so existing data is never lost.
 */
export default function CitySelect({ value, onChange, disabled, className, placeholder = '— Select City —' }: CitySelectProps) {
  const current = (value || '').trim();
  const hasCustomValue = current !== '' && !LIBERIA_CITIES.includes(current);

  return (
    <select
      className={`form-select ${className || ''}`}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {hasCustomValue && <option value={current}>{current}</option>}
      {LIBERIA_CITIES.map((city) => (
        <option key={city} value={city}>{city}</option>
      ))}
    </select>
  );
}
