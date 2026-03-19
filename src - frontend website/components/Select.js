import React, { useState, useRef, useEffect } from 'react';
import './Select.css';

/**
 * Custom dropdown - no border, shadow only, gap between trigger and list.
 * API compatible with native select: value, onChange, children as <option> elements.
 */
function Select({ value, onChange, children, id, name, className = '', required, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const options = React.Children.map(children, (child) => {
    if (child?.type !== 'option') return null;
    return { value: child.props.value, label: child.props.children };
  }).filter(Boolean);

  const selectedOption = options.find((o) => String(o.value) === String(value));
  const displayLabel = selectedOption ? selectedOption.label : (placeholder || 'Select...');

  const handleSelect = (optionValue) => {
    onChange({ target: { name, value: optionValue } });
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  return (
    <div
      ref={ref}
      className={`custom-select ${open ? 'custom-select-open' : ''} ${className}`.trim()}
      data-disabled={disabled ? true : undefined}
    >
      <button
        type="button"
        id={id}
        className="custom-select-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="custom-select-value">{displayLabel}</span>
        <span className="custom-select-chevron" aria-hidden>▼</span>
      </button>
      {open && (
        <div className="custom-select-list" role="listbox">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={String(opt.value) === String(value)}
              className={`custom-select-option ${String(opt.value) === String(value) ? 'custom-select-option-selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Select;
