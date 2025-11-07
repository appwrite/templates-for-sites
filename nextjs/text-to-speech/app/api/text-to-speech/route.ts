import { NextRequest, NextResponse } from 'next/server';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { VOICES } from '@/constants/voices';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice_id, stability, style, speed } = body;

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key is not configured' },
        { status: 500 }
      );
    }

    const voiceId = voice_id || VOICES[0].id; // Default voice: Rachel

    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey: apiKey,
    });

    // Generate speech using the SDK
    const audio = await elevenlabs.textToSpeech.convert(voiceId, {
      text,
      modelId: 'eleven_multilingual_v2',
      voiceSettings: {
        stability: stability ?? 0.5,
        style: style ?? 0.0,
        speed: speed ?? 1.0,
      },
    });

    // Convert the audio stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = audio.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const audioBuffer = Buffer.concat(chunks);
    const audioBase64 = audioBuffer.toString('base64');

    return NextResponse.json({
      audio: `data:audio/mpeg;base64,${audioBase64}`,
    });
  } catch (error) {
    console.error('Error generating speech:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to generate speech' 
      },
      { status: 500 }
    );
  }
}

