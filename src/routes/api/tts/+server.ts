import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ELEVENLABS_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
  console.log('========== API TTS CALLED ==========');
  
  try {
    const body = await request.json();
    const { text } = body;
    console.log('Texte:', text?.substring(0, 50));
    
    if (!text) {
      return json({ message: 'Pas de texte' }, { status: 400 });
    }
    
    console.log('Clé API:', ELEVENLABS_API_KEY ? 'PRESENT ✓' : 'MISSING ✗');
    
    if (!ELEVENLABS_API_KEY) {
      return json({ message: 'Clé API manquante' }, { status: 500 });
    }
    
    const VOICE_ID = 'imRmmzTqlLHt9Do1HufF';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
    
    console.log('Appel ElevenLabs...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
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

    console.log('Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Erreur:', errorText);
      return json({ message: errorText }, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();
    console.log('Audio reçu:', audioBuffer.byteLength, 'bytes ✓');

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg'
      }
    });

  } catch (err) {
    console.error('ERREUR:', err);
    return json({ 
      message: (err instanceof Error ? err.message : String(err)) 
    }, { status: 500 });
  }
};