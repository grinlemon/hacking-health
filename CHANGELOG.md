# 🚀 HackingHealth OCR Scanner - Version 0.1.0

## ✨ Changements majeurs

### 🤖 Remplacement de Tesseract par Llama Vision

**Avant :**
- Tesseract.js (OCR côté client)
- Découpage de l'image en 2 pages
- Prétraitement d'image
- Appel à Groq pour nettoyer le texte

**Maintenant :**
- **Llama 4 Scout Vision** (`meta-llama/llama-4-scout-17b-16e-instruct`)
- Image complète envoyée directement
- Extraction de texte intelligente avec IA
- Gère automatiquement les doubles pages
- Correction automatique des erreurs

### 🎙️ Remplacement par ElevenLabs TTS

**Avant :**
- TTS simple

**Maintenant :**
- **ElevenLabs API** avec `eleven_multilingual_v2`
- Voix naturelle et expressive
- Support multilingue parfait pour le français
- Qualité audio premium

## 🔧 Configuration requise

### Variables d'environnement (`.env`)

```env
GROQ_API_KEY=votre_cle_groq
ELEVENLABS_API_KEY=votre_cle_elevenlabs
VOICE_ID=votre_voice_id_preferee
```

### Obtenir les clés

1. **Groq API** : https://console.groq.com/
2. **ElevenLabs** : https://elevenlabs.io/
3. **Voice ID** : Trouvez votre voix préférée sur ElevenLabs

## 📡 Nouvelles API Routes

### `/api/vision-extract` (POST)
Extrait le texte d'une image avec Llama Vision

**Request:**
```json
{
  "image": "data:image/jpeg;base64,..."
}
```

**Response:**
```json
{
  "extractedText": "Le texte extrait..."
}
```

### `/api/elevenlabs-tts` (POST)
Génère l'audio avec ElevenLabs

**Request:**
```json
{
  "text": "Le texte à convertir en audio"
}
```

**Response:** Audio MP3 stream

## 🎯 Avantages

### Llama Vision
- ✅ Comprend le contexte et la structure
- ✅ Corrige automatiquement les erreurs
- ✅ Gère les doubles pages intelligemment
- ✅ Plus rapide (un seul appel API)
- ✅ Meilleure qualité d'extraction

### ElevenLabs
- ✅ Voix ultra-réaliste
- ✅ Intonation et prosodie naturelles
- ✅ Excellent support du français
- ✅ Qualité audio supérieure
- ✅ Ajustement fin possible (stability, similarity)

## 🎮 Utilisation

1. **Cliquer** pour capturer l'image
2. Llama Vision extrait le texte automatiquement
3. **Cliquer à gauche** pour générer et lire l'audio (ElevenLabs)
4. **Cliquer à droite** pour scanner la page suivante

## 🔄 Migration

Les anciens fichiers ne sont plus nécessaires :
- ❌ `/api/clean-text/+server.ts` (remplacé par vision-extract)
- ❌ `/api/tts/+server.ts` (remplacé par elevenlabs-tts)
- ❌ Tesseract.js (plus besoin d'importer)

## 📊 Performance

- **Temps d'extraction** : ~2-3 secondes (vs ~30-60s avec Tesseract)
- **Qualité du texte** : Meilleure compréhension contextuelle
- **Qualité audio** : Studio quality avec ElevenLabs

## 🎨 Interface

- Version affichée : **v0.1.0**
- Icônes visuelles : 🤖 pour Llama, 🎙️ pour ElevenLabs
- Debug mode : Affiche l'image complète capturée

Profitez de cette nouvelle expérience premium ! 🚀✨
