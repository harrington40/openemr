import { isInvalidLiberiaNationalNumber } from '../../utils/liberia';

const AREA_CODE = '231';

const digitsOnly = (v?: string | null): string => (v || '').replace(/\D/g, '');

/** Strip the 231 country code (and an optional leading 1) to get the 9-digit national number. */
function localDigits(value?: string | null): string {
  let d = digitsOnly(value);
  if (d.startsWith('231') && d.length > 3) d = d.slice(3);
  if (d.length === 10 && d.startsWith('1')) d = d.slice(1);
  return d.slice(0, 9);
}

/** Format a 9-digit Liberia national number as "XXX-XXXXXX" (e.g., 888-955552). */
function formatLocal(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length <= 3) return d;
  return `${d.slice(0, 3)}-${d.slice(3, 9)}`;
}

/** Build the full number with the 231 country code (231 + 9 national digits). */
function toPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d ? `${AREA_CODE}${d}` : '';
}

interface PhoneInputProps {
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Liberia phone input with a fixed "(231)" country code and a formatted
 * national "XXX-XXXXXX" field. Emits the full 12-digit number (231XXXXXXXXX).
 * Flags a national number that itself begins with "231" as invalid, since
 * that would duplicate the country code (e.g. 231 231…).
 */
export default function PhoneInput({ value, onChange, disabled, placeholder = '888-955552', className }: PhoneInputProps) {
  const local = localDigits(value);
  const invalid = isInvalidLiberiaNationalNumber(local);

  const handleChange = (raw: string) => {
    onChange(toPhone(raw));
  };

  return (
    <div>
      <div className="input-group">
        <span className="input-group-text bg-light fw-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
          (231)
        </span>
        <input
          className={`form-control ${invalid ? 'is-invalid' : ''} ${className || ''}`}
          inputMode="tel"
          value={formatLocal(local)}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={invalid}
        />
      </div>
      {invalid && (
        <small className="text-danger d-block mt-1" style={{ fontSize: '0.75rem' }}>
          <i className="bi bi-exclamation-circle me-1"></i>
          Invalid — the first three digits after the country code cannot be 231.
        </small>
      )}
    </div>
  );
}
