import React from 'react';
import { useTheme } from '../context/ThemeContext';
import './ThemeToggle.css';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="toggle-right">
      <button
        className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
        onClick={() => theme !== 'light' && toggleTheme()}
        aria-label="Switch to light mode"
      >
        ☀️ Light
      </button>
      <button
        className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
        onClick={() => theme !== 'dark' && toggleTheme()}
        aria-label="Switch to dark mode"
      >
        🌙 Dark
      </button>
    </div>
  );
};

export default ThemeToggle;