import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// ID de voix françaises ElevenLabs
const FRENCH_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Voix Adam (française)

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { text } = await request.json();

    if (!text || text.length === 0) {
      throw error(400, 'Texte manquant');
    }

    if (!env.ELEVENLABS_API_KEY) {
      throw error(500, 'ELEVENLABS_API_KEY non configurée dans .env');
    }

    console.log(`Génération audio pour ${text.length} caractères`);

    // Appel API ElevenLabs
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${FRENCH_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs error:', errorText);
      throw error(response.status, `Erreur API: ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    });

  } catch (err) {
    console.error('Erreur TTS:', err);
    throw error(500, 'Erreur génération audio: ' + (err as Error).message);
  }
};