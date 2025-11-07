'use client';

import { useState, useRef, useEffect } from 'react';
import VoiceDropdown from '@/components/VoiceDropdown';
import AudioPlayer from '@/components/AudioPlayer';

interface VoiceSettings {
  voice_id: string;
  stability: number;
  style: number;
  speed: number;
}

export default function Home() {
  const [text, setText] = useState('"Hello world" is a great phrase to put yourself out there, try something new, and explore new possibilities. You never know what you might find or how surprised you might be. Here\'s to risk-taking, exploration, and saying hello to the world. Cheers.');
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>({
    voice_id: '21m00Tcm4TlvDq8ikWAM',
    stability: 0.5,
    style: 0.0,
    speed: 1.0,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [text]);

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError('Please enter some text');
      return;
    }

    setLoading(true);
    setError(null);
    setAudioUrl(null);

    try {
      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          ...settings,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate speech');
      }

      setAudioUrl(data.audio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-400/20 to-purple-400/20 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-purple-400/20 to-pink-400/20 rounded-full blur-3xl"></div>
      </div>

      <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20 max-w-5xl">
        {/* Header Section */}
        <div className="text-center mb-12 sm:mb-16">
          <div className="inline-flex items-center justify-center gap-8 mb-6">
            <a href="https://elevenlabs.io/" target="_blank" className="hover:opacity-80 transition-opacity relative">
              <img 
                src="/logos/elevenlabs.png" 
                alt="ElevenLabs" 
                className="w-24 sm:w-32 h-auto dark:hidden"
              />
              <img 
                src="/logos/dark/elevenlabs.png" 
                alt="ElevenLabs" 
                className="w-24 sm:w-32 h-auto hidden dark:block"
              />
            </a>
            <div className="h-8 sm:h-10 w-px bg-slate-300 dark:bg-slate-700"></div>
            <a href="https://appwrite.io/" target="_blank" className="hover:opacity-80 transition-opacity relative">
              <img 
                src="/logos/appwrite.png" 
                alt="Appwrite" 
                className="w-24 sm:w-32 h-auto dark:hidden"
              />
              <img 
                src="/logos/dark/appwrite.png" 
                alt="Appwrite" 
                className="w-24 sm:w-32 h-auto hidden dark:block"
              />
            </a>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 dark:text-white mb-4 tracking-tight flex items-center justify-center gap-3">
            Text to Speech 
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
            Transform your text into natural, human-like speech
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-900/10 dark:shadow-slate-900/50 border border-slate-200/50 dark:border-slate-800/50 p-6 sm:p-8 lg:p-10">
          {/* Text Input Section */}
          <div className="mb-8">
            <label
              htmlFor="text-input"
              className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wide"
            >
              Enter Your Text
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                id="text-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste your text here to convert it to speech..."
                className="w-full min-h-32 sm:min-h-36 px-5 py-4 border-2 border-slate-200 dark:border-slate-700 rounded-xl 
                         bg-white dark:bg-slate-800/50 text-slate-900 dark:text-white 
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                         resize-none transition-all duration-200 overflow-hidden
                         placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
              <div className="absolute bottom-4 right-4 text-xs font-medium text-slate-400 dark:text-slate-500 bg-white/80 dark:bg-slate-800/80 px-2 py-1 rounded">
                {text.length} characters
              </div>
            </div>
          </div>

          {/* Settings Toggle */}
          <div className="mb-6">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="group flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <svg 
                className={`w-4 h-4 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {showSettings ? 'Hide' : 'Show'} Advanced Settings
            </button>
          </div>

          {/* Advanced Settings */}
          {showSettings && (
            <div className="mb-8 p-6 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-800/30 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Voice Selection */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  Voice Selection
                </label>
                <VoiceDropdown
                  value={settings.voice_id}
                  onChange={(voiceId) =>
                    setSettings({ ...settings, voice_id: voiceId })
                  }
                />
              </div>

              {/* Stability */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Stability
                  </label>
                  <span className="text-sm font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-lg">
                    {settings.stability.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={settings.stability}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      stability: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                           [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500
                           [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:transition-all
                           [&::-webkit-slider-thumb]:hover:scale-110
                           [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
                           [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0
                           [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:transition-all
                           [&::-moz-range-thumb]:hover:scale-110"
                />
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Lower values make the voice more variable and expressive
                </div>
              </div>

              {/* Style */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Style
                  </label>
                  <span className="text-sm font-mono text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1 rounded-lg">
                    {settings.style.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={settings.style}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      style: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                           [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500
                           [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:transition-all
                           [&::-webkit-slider-thumb]:hover:scale-110
                           [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
                           [&::-moz-range-thumb]:bg-purple-500 [&::-moz-range-thumb]:border-0
                           [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:transition-all
                           [&::-moz-range-thumb]:hover:scale-110"
                />
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Higher values add more style and emotion
                </div>
              </div>

              {/* Speed */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Speed
                  </label>
                  <span className="text-sm font-mono text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-900/20 px-2.5 py-1 rounded-lg">
                    {settings.speed.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.7"
                  max="1.2"
                  step="0.01"
                  value={settings.speed}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      speed: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                           [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pink-500
                           [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:transition-all
                           [&::-webkit-slider-thumb]:hover:scale-110
                           [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full
                           [&::-moz-range-thumb]:bg-pink-500 [&::-moz-range-thumb]:border-0
                           [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:transition-all
                           [&::-moz-range-thumb]:hover:scale-110"
                />
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  1.0 is default speed. Range: 0.7x (slower) to 1.2x (faster)
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800/50 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !text.trim()}
            className="group relative w-full py-4 px-8 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 
                     disabled:from-slate-300 disabled:to-slate-400
                     text-white font-semibold rounded-xl transition-all duration-200
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900
                     disabled:cursor-not-allowed shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30
                     disabled:shadow-none transform hover:scale-[1.02] disabled:transform-none"
          >
            <span className="relative flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating Speech...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Generate Speech
                </>
              )}
            </span>
          </button>

          {/* Audio Player */}
          {audioUrl && (
            <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <AudioPlayer audioUrl={audioUrl} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
