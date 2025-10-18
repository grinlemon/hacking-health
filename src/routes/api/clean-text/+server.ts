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
- Résumer ou raccourcir le texte
- Paraphraser ou reformuler (sauf si nécessaire pour corriger une erreur OCR)

✅ TU DOIS :

1. **Corriger les erreurs OCR typiques :**
   - Remplacer "1" par "l", "0" par "O", "|" par "l", "rn" par "m"
   - Corriger "vv" en "w", "c" mal placé en "e"
   - Exemple : "1e ch4t" → "le chat"

2. **Supprimer TOUS les artefacts parasites :**
   - Lettres isolées sans sens : "h h", "l l", "aa", "ii", "nn"
   - Caractères bizarres : "|", "~", "^", "_", "»", "«" seuls
   - Tirets multiples : "---", "___"
   - Points suspensifs mal formés : ". . ." → "..."
   - Numéros de page isolés
   - Espaces multiples

3. **Reformater en paragraphes fluides :**
   - Supprimer les sauts de ligne au milieu d'une phrase
   - Fusionner les lignes qui appartiennent au même paragraphe
   - Garder UN SEUL saut de ligne entre paragraphes différents
   - Le texte doit être continu et agréable à lire

4. **Corriger la ponctuation :**
   - "mot.Autre" → "mot. Autre"
   - "mot,autre" → "mot, autre"
   - Gérer les tirets de césure : "indépen-\ndance" → "indépendance"

5. **Corriger LÉGÈREMENT si le sens est altéré :**
   - Si une phrase n'a pas de sens à cause de l'OCR, corriger pour rendre cohérent
   - Exemple : "Le chat mange de poison" → "Le chat mange du poisson" (si contexte évident)
   - MAIS : en cas de doute, ne rien changer

${isDoublePage ? `
📖 NOTE : Le texte peut contenir "--- PAGE SUIVANTE ---" qui sépare deux pages.
Tu peux retirer ce marqueur et créer une transition naturelle entre les pages.
` : ''}

📝 FORMAT DE SORTIE :
Retourne un texte fluide, structuré en paragraphes clairs, sans artefacts, prêt à être lu à voix haute.
Retourne UNIQUEMENT ce texte, sans commentaire.`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Nettoie ce texte OCR :\n\n${text}`
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.15,
      max_tokens: 4000
    });

    let cleanedText = completion.choices[0]?.message?.content?.trim() || text;
    
    // Post-traitement supplémentaire pour garantir la propreté
    cleanedText = cleanedText
      // Supprimer le marqueur de page s'il reste
      .replace(/---\s*PAGE\s*SUIVANTE\s*---/gi, '\n\n')
      // Normaliser les espaces (max 1 espace)
      .replace(/[ \t]+/g, ' ')
      // Normaliser les sauts de ligne (max 2 pour séparer paragraphes)
      .replace(/\n{3,}/g, '\n\n')
      // Supprimer espaces en début/fin de chaque ligne
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0) // Supprimer lignes vides
      .join('\n\n') // Recréer avec double saut entre paragraphes
      .trim();
    
    console.log('✨ Texte nettoyé (longueur):', cleanedText.length);
    console.log('📊 Différence:', cleanedText.length - text.length, 'caractères');
    console.log('📄 Aperçu:', cleanedText.substring(0, 150) + '...');

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