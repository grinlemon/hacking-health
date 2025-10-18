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

    const systemPrompt = `Tu es un expert en nettoyage de texte OCR. Ton objectif est de produire un texte propre, fluide et agréable à lire à voix haute.

⚠️ NE JAMAIS :
- Ajouter du contenu qui n'existe pas dans le texte original
- Supprimer des paragraphes entiers
- Résumer ou raccourcir le texte
- Paraphraser ou reformuler (sauf si nécessaire pour corriger une erreur OCR)

✅ TU DOIS :

1. **Corriger les erreurs OCR typiques :**
   - Remplacer "1" par "l", "0" par "O", "|" par "l", "rn" par "m"
   - Corriger "vv" en "w", "c" mal placé en "e"
   - Exemple : "1e ch4t" → "le chat"

2. **Supprimer UNIQUEMENT les artefacts parasites évidents :**
   - Lettres isolées répétées : "h h h", "l l l", "aa aa"
   - Caractères bizarres seuls : "|", "~", "^", "_" isolés
   - Tirets multiples : "---", "___" (sauf "--- PAGE SUIVANTE ---")
   - Numéros de page isolés sur une ligne
   - Espaces multiples → un seul espace

3. **Reformater en paragraphes fluides :**
   - Supprimer les sauts de ligne au milieu d'une phrase
   - Fusionner les lignes qui appartiennent au même paragraphe
   - Garder les sauts de ligne entre paragraphes distincts
   - Le texte doit être continu et agréable à lire

4. **Corriger la ponctuation :**
   - "mot.Autre" → "mot. Autre"
   - "mot,autre" → "mot, autre"
   - Gérer les tirets de césure : "indépen-\ndance" → "indépendance"

5. **IMPORTANT - Préserver tout le contenu :**
   - Si tu vois "--- PAGE SUIVANTE ---", c'est qu'il y a DEUX pages de texte
   - Tu dois conserver TOUT le texte des DEUX pages
   - Retire juste le marqueur "--- PAGE SUIVANTE ---" et continue le texte naturellement

📝 FORMAT DE SORTIE :
Retourne un texte fluide, structuré en paragraphes clairs, sans artefacts, prêt à être lu à voix haute.
IMPORTANT : Conserve TOUT le contenu, ne supprime que les artefacts évidents.
Retourne UNIQUEMENT ce texte, sans commentaire.`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Nettoie ce texte OCR (il contient potentiellement 2 pages) :\n\n${text}`
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1, // Plus conservateur
      max_tokens: 4000
    });

    let cleanedText = completion.choices[0]?.message?.content?.trim() || text;
    
    // Post-traitement MINIMALISTE pour ne pas perdre de contenu
    cleanedText = cleanedText
      // Supprimer le marqueur de page s'il reste
      .replace(/---\s*PAGE\s*SUIVANTE\s*---/gi, '\n\n')
      // Normaliser espaces multiples en un seul
      .replace(/[ \t]+/g, ' ')
      // Normaliser plus de 3 sauts de ligne en 2
      .replace(/\n{4,}/g, '\n\n')
      // Supprimer espaces en fin de ligne
      .replace(/[ \t]+$/gm, '')
      .trim();
    
    console.log('✨ Texte nettoyé (longueur):', cleanedText.length);
    console.log('📊 Différence:', cleanedText.length - text.length, 'caractères');
    console.log('📄 Premier paragraphe:', cleanedText.substring(0, 150) + '...');
    console.log('📄 Dernier paragraphe:', '...' + cleanedText.substring(cleanedText.length - 150));

    return json({ 
      cleanedText,
      originalText: text 
    });

  } catch (err) {
    console.error('❌ Erreur Groq:', err);
    const body = await request.json();
    return json({ 
      cleanedText: body.text,
      error: (err instanceof Error ? err.message : String(err))
    });
  }
};