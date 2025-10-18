import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ELEVENLABS_API_KEY, VOICE_ID } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
  console.log('========== API ELEVENLABS TTS CALLED ==========');

  try {
    const { text } = await request.json();

    if (!text) {
      throw error(400, 'Pas de texte fourni');
    }

    console.log('📝 Texte reçu (longueur):', text.length);

    if (!ELEVENLABS_API_KEY) {
      console.error('ELEVENLABS_API_KEY manquante');
      throw error(500, 'Clé ElevenLabs manquante');
    }

    const voiceId = VOICE_ID || '3KUqqj6ZlrH5jkEAwiMb'; // Voix par défaut depuis .env

    console.log('🎙️ Génération audio avec ElevenLabs...');
    console.log('🎤 Voice ID:', voiceId);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2', // Supporte le français
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erreur ElevenLabs:', errorText);
      throw error(response.status, `Erreur ElevenLabs: ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    console.log('✅ Audio généré (taille):', audioBuffer.byteLength, 'bytes');

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    });

  } catch (err) {
    console.error('Erreur complète:', err);
    if (err instanceof Error) {
      throw error(500, err.message);
    }
    throw error(500, 'Erreur inconnue');
  }
};
