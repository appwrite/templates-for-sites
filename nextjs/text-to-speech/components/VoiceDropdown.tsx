'use client';

import { useState, useRef, useEffect } from 'react';
import { VOICES, Voice } from '@/constants/voices';

interface VoiceDropdownProps {
  value: string;
  onChange: (voiceId: string) => void;
}

export default function VoiceDropdown({ value, onChange }: VoiceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedVoice = VOICES.find((v) => v.id === value) || VOICES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (voice: Voice) => {
    onChange(voice.id);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 border-2 border-slate-200 dark:border-slate-700 rounded-xl 
                 bg-white dark:bg-slate-800/50 text-left
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                 hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-200
                 shadow-sm hover:shadow-md"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
              {selectedVoice.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
              {selectedVoice.description}
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-slate-400 dark:text-slate-500 transition-transform duration-200 flex-shrink-0 ${
              isOpen ? 'transform rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-2 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl max-h-64 overflow-auto animate-in fade-in slide-in-from-top-2 duration-200">
          {VOICES.map((voice) => (
            <button
              key={voice.id}
              type="button"
              onClick={() => handleSelect(voice)}
              className={`w-full px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                voice.id === value
                  ? 'bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-l-4 border-blue-500'
                  : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold mb-1 ${
                    voice.id === value 
                      ? 'text-blue-900 dark:text-blue-100' 
                      : 'text-slate-900 dark:text-white'
                  }`}>
                    {voice.name}
                  </div>
                  <div className={`text-xs line-clamp-1 ${
                    voice.id === value
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}>
                    {voice.description}
                  </div>
                </div>
                {voice.id === value && (
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

