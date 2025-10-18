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
- Paraphraser ou reformuler
- Résumer ou raccourcir
- Ajouter des explications

✅ CORRECTIONS AUTORISÉES UNIQUEMENT :
0. Il faut absolument que le texte de sortie soit fluide et lisible.
1. Erreurs de caractères évidents : l→I, O→0, rn→m, vv→w, |→l
2. Lettres isolées sans sens : "h h" → supprimer, "l l" → supprimer, "aa bb" → supprimer
3. Ponctuation manquante évidente : "mot.Mot" → "mot. Mot"
4. Espaces manquants : "motmot" → "mot mot" (si c'est évident)
5. Tirets de césure en fin de ligne : "indé-\npendance" → "indépendance"

${isDoublePage ? `
📖 LIVRE OUVERT (2 PAGES) :
Analyser la structure du texte :
- Si tu détectes DEUX colonnes distinctes (page gauche | page droite)
- IMPORTANT : Lire d'abord TOUTE la page/colonne GAUCHE de haut en bas
- Puis ajouter un double saut de ligne "\n\n"
- Puis lire TOUTE la page/colonne DROITE de haut en bas
- Ne JAMAIS alterner entre les deux pages ligne par ligne

Indices de détection :
- Numéros de pages différents (ex: "42" à gauche, "43" à droite)
- Chapitres différents
- Paragraphes qui ne se suivent pas logiquement
- Marges/espacements inhabituels au centre
` : ''}

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