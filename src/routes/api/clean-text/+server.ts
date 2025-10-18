// src/routes/api/clean-text/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import Groq from 'groq-sdk';

export const POST: RequestHandler = async ({ request }) => {
  console.log('========== API CLEAN TEXT CALLED ==========');
  
  try {
    const { text, isDoublePage = false } = await request.json();
    
    if (!text) {
      return json({ message: 'Pas de texte' }, { status: 400 });
    }

    console.log('Texte brut (longueur):', text.length);

    if (!env.GROQ_API_KEY) {
      console.error('GROQ_API_KEY manquante');
      return json({ message: 'Clé Groq manquante' }, { status: 500 });
    }

    const groq = new Groq({
      apiKey: env.GROQ_API_KEY
    });

    const systemPrompt = `Tu es un assistant qui corrige UNIQUEMENT les erreurs d'OCR d'un livre.

⚠️ RÈGLES STRICTES - NE JAMAIS :
- Ajouter du texte qui n'existe pas
- Résumer ou raccourcir
- Ajouter des explications

✅ CORRECTIONS AUTORISÉES UNIQUEMENT :
1. Corriger les erreurs typographiques (ex: "1" au lieu de "l", "0" au lieu de "O")
2. Supprime les sauts de ligne inutiles au sein d'un même paragraphe
3. Supprime les caractères bizarres qui n'ont pas leur place dans un texte
4. Le texte doit être fluide et lisible, comme dans un livre imprimé
5. Assure toi que le texte soit cohérent sinon apporte de légères corrections pour que ça ait du sens

Format de sortie : Retourne UNIQUEMENT le texte corrigé, sans commentaire, sans ajout.`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Texte OCR à corriger :\n\n${text}`
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1, // Très bas pour être conservateur
      max_tokens: 4000
    });

    const cleanedText = completion.choices[0]?.message?.content?.trim() || text;
    
    console.log('Texte nettoyé (longueur):', cleanedText.length);
    console.log('Différence:', cleanedText.length - text.length, 'caractères');

    return json({ 
      cleanedText,
      originalText: text 
    });

  } catch (err) {
    console.error('Erreur Groq:', err);
    const body = await request.json();
    return json({ 
      cleanedText: body.text,
      error: (err instanceof Error ? err.message : String(err))
    });
  }
};