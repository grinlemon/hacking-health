import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
  console.log('========== API TTS CALLED ==========');
  
  try {
    const body = await request.json();
    const { text } = body;
    console.log('Texte reçu:', text?.substring(0, 50));
    
    if (!text) {
      return json({ message: 'Pas de texte' }, { status: 400 });
    }
    
    const apiKey = env.ELEVENLABS_API_KEY;
    const voiceId = env.VOICE_ID || '3KUqqj6ZlrH5jkEAwiMb';
    console.log('Clé API:', apiKey ? 'PRESENT ✓' : 'MISSING ✗');
    
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY manquante dans les variables d\'environnement');
      return json({ message: 'Clé API manquante' }, { status: 500 });
    }
    
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    
    console.log('Appel ElevenLabs...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    console.log('Status ElevenLabs:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erreur ElevenLabs:', errorText);
      return json({ 
        message: 'Erreur ElevenLabs: ' + errorText 
      }, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();
    console.log('Audio reçu:', audioBuffer.byteLength, 'bytes ✓');

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    });

  } catch (err) {
    console.error('========== ERREUR ==========');
    console.error(err);
    return json({ 
      message: (err instanceof Error ? err.message : String(err)) 
    }, { status: 500 });
  }
};