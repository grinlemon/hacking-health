import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import Groq from 'groq-sdk';

export const POST: RequestHandler = async ({ request }: { request: Request }) => {
  console.log('========== API CLEAN TEXT CALLED ==========');
  
  try {
    const { text } = await request.json();
    
    if (!text) {
      return json({ message: 'Pas de texte' }, { status: 400 });
    }

    console.log('Texte brut (avant):', text.substring(0, 100));

    if (!env.GROQ_API_KEY) {
      console.error('GROQ_API_KEY manquante');
      return json({ message: 'Clé Groq manquante' }, { status: 500 });
    }

    const groq = new Groq({
      apiKey: env.GROQ_API_KEY
    });

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `Tu es un assistant qui corrige les erreurs d'OCR. 
Tu dois:
- Corriger les fautes d'orthographe évidentes
- Corriger les erreurs de reconnaissance (l/1, O/0, etc.)
- Remettre la ponctuation correcte
- Garder le sens et le ton original
- Ne PAS ajouter de texte qui n'était pas là
- Retourner UNIQUEMENT le texte corrigé, sans commentaire

Exemple:
Input: "Le ch4t est sur |e tapis. 1l dort profondement."
Output: "Le chat est sur le tapis. Il dort profondément."`
        },
        {
          role: 'user',
          content: text
        }
      ],
      model: 'llama-3.3-70b-versatile', // Rapide et gratuit
      temperature: 0.3,
      max_tokens: 2000
    });

    const cleanedText = completion.choices[0]?.message?.content || text;
    
    console.log('Texte nettoyé (après):', cleanedText.substring(0, 100));

    return json({ 
      cleanedText,
      originalText: text 
    });

  } catch (err) {
    console.error('Erreur Groq:', err);
    // En cas d'erreur, retourner le texte original
    const { text } = await request.json();
    return json({ 
      cleanedText: text,
      error: (err instanceof Error ? err.message : String(err))
    });
  }
};