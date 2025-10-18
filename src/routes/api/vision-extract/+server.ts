import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GROQ_API_KEY } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
  console.log('========== API VISION EXTRACT CALLED ==========');

  try {
    const { image } = await request.json();

    if (!image) {
      return json({ message: 'Pas d\'image fournie' }, { status: 400 });
    }

    console.log('📸 Image reçue (longueur):', image.length);

    if (!GROQ_API_KEY) {
      console.error('GROQ_API_KEY manquante');
      return json({ message: 'Clé Groq manquante' }, { status: 500 });
    }

    // Appel à l'API Groq avec Llama Vision
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Tu es un expert en extraction de texte depuis des images de livres. Analyse cette image et extrais TOUT le texte visible, qu'il s'agisse d'une page simple ou d'une double page.

Instructions importantes :
- Extrais le texte dans l'ordre de lecture naturel (de gauche à droite, de haut en bas)
- Si c'est une double page, lis d'abord la page de gauche en entier, puis la page de droite
- Préserve la structure des paragraphes
- Ignore les numéros de page
- Ne commente pas, ne décris pas l'image, donne UNIQUEMENT le texte extrait
- Assure-toi que le texte est fluide et cohérent

Retourne uniquement le texte extrait, propre et lisible.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: image
                }
              }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erreur Groq Vision:', errorText);
      throw new Error(`Erreur API Groq: ${response.status}`);
    }

    const data = await response.json();
    const extractedText = data.choices[0]?.message?.content || '';

    console.log('✅ Texte extrait (longueur):', extractedText.length);
    console.log('📄 Aperçu:', extractedText.substring(0, 200));

    return json({
      extractedText
    });

  } catch (err) {
    console.error('Erreur Vision Extract:', err);
    return json({
      extractedText: '',
      error: (err instanceof Error ? err.message : String(err))
    }, { status: 500 });
  }
};
