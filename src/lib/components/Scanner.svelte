<script lang="ts">
  import { browser } from '$app/environment';

  // Version de l'application
  const APP_VERSION = 'v0.0.20';

  // Variables réactives Svelte 5
  let video = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();
  let audioElement = $state<HTMLAudioElement>();

  // État simplifié
  let stream = $state<MediaStream | null>(null);
  let extractedText = $state('');
  let rawOcrText = $state('');
  let statusMessage = $state('');
  let progressPercent = $state(0);
  
  // États du workflow
  type AppState = 'camera' | 'processing' | 'ready' | 'playing' | 'paused';
  let appState = $state<AppState>('camera');
  
  let audioUrl = $state<string | null>(null);
  let debugLeftImage = $state<string | null>(null);
  let debugRightImage = $state<string | null>(null);
  let showDebug = $state(false);
  let countdownSeconds = $state(0);
  let countdownInterval = $state<number | null>(null);
  
  // Gestion du streaming audio
  let audioChunks = $state<string[]>([]);
  let currentChunkIndex = $state(0);
  let isGeneratingAudio = $state(false);
  let audioQueue = $state<string[]>([]);
  let generatedAudioUrls = $state<string[]>([]); // Stocker tous les URLs générés
  
  // Suivi détaillé pour le debug
  type ChunkStatus = 'waiting' | 'generating' | 'ready' | 'playing' | 'played';
  let chunkStatuses = $state<ChunkStatus[]>([]);

  // Démarrer la caméra automatiquement
  async function initCamera(): Promise<void> {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      stream = mediaStream;
      appState = 'camera';
    } catch (err) {
      console.error('Erreur caméra:', err);
      statusMessage = 'Erreur caméra: ' + (err as Error).message;
    }
  }

  // Capturer et tout traiter
  async function startProcessing(): Promise<void> {
    if (!canvas || !video) return;
    
    appState = 'processing';
    statusMessage = 'Capture en cours...';
    progressPercent = 0;

    try {
      // 1. CAPTURER L'IMAGE
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const capturedImage = canvas.toDataURL('image/jpeg', 0.95);
      debugLeftImage = capturedImage; // Pour le debug
      
      // Arrêter la caméra
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }

      progressPercent = 20;

      // 2. EXTRAIRE LE TEXTE AVEC LLAMA VISION
      statusMessage = 'Llama Vision analyse l\'image...';
      
      const visionResponse = await fetch('/api/vision-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image: capturedImage
        })
      });

      progressPercent = 60;

      if (!visionResponse.ok) {
        throw new Error('Erreur lors de l\'extraction du texte');
      }

      const { extractedText: visionText } = await visionResponse.json();
      extractedText = visionText;
      rawOcrText = visionText;
      
      console.log('� TEXTE EXTRAIT (longueur):', visionText.length);
      console.log('📄 TEXTE EXTRAIT (début):', visionText.substring(0, 200));

      progressPercent = 100;
      statusMessage = 'Texte extrait - Génération audio...';
      appState = 'ready';
      
      // Lancer automatiquement la conversion audio
      await playAudio();

    } catch (err) {
      console.error('Erreur:', err);
      statusMessage = 'Erreur: ' + (err as Error).message;
      appState = 'camera';
      await initCamera();
    }
  }

  // Diviser le texte en chunks pour le streaming
  function splitTextIntoChunks(text: string, chunkSize: number = 500): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks: string[] = [];
    let currentChunk = '';
    
    // Découper par phrases en préservant la ponctuation
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    
    // Si aucune phrase n'est détectée, diviser par taille de caractères
    if (sentences.length === 0) {
      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize).trim());
      }
    } else {
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }
      
      // IMPORTANT: Ajouter le dernier chunk s'il reste du texte
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      
      // Vérifier qu'on a tout le texte
      const totalCharsInChunks = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const originalTextLength = text.replace(/\s+/g, ' ').trim().length;
      
      console.log(`📊 Découpage: ${chunks.length} chunks, ${totalCharsInChunks} caractères sur ${originalTextLength} originaux`);
      
      // Si on a perdu du texte, ajouter ce qui manque
      if (totalCharsInChunks < originalTextLength * 0.95) {
        console.warn('⚠️ Texte manquant détecté, ajout du reste...');
        const allChunksText = chunks.join(' ');
        const missingText = text.substring(allChunksText.length);
        if (missingText.trim().length > 0) {
          chunks.push(missingText.trim());
        }
      }
    }

    // Initialiser les statuts
    chunkStatuses = chunks.map(() => 'waiting' as ChunkStatus);

    return chunks;
  }

  // Générer l'audio d'un chunk
  async function generateAudioChunk(text: string, index: number): Promise<string> {
    // Vérifier si on a déjà généré cet audio
    if (generatedAudioUrls[index]) {
      console.log(`♻️ Réutilisation du chunk ${index + 1} (déjà généré)`);
      chunkStatuses[index] = 'ready';
      return generatedAudioUrls[index];
    }
    
    chunkStatuses[index] = 'generating';
    
    const response = await fetch('/api/elevenlabs-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      throw new Error('Erreur génération audio');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    // Stocker l'URL généré
    generatedAudioUrls[index] = url;
    chunkStatuses[index] = 'ready';
    
    console.log(`✅ Chunk ${index + 1} généré et sauvegardé`);
    
    return url;
  }

  // Lire le prochain chunk
  async function playNextChunk(): Promise<void> {
    if (!audioElement) return;

    // Marquer le chunk précédent comme joué
    if (currentChunkIndex > 0 && currentChunkIndex < chunkStatuses.length) {
      chunkStatuses[currentChunkIndex - 1] = 'played';
    }

    // Incrémenter l'index
    currentChunkIndex++;
    
    // Vérifier si on a un chunk suivant
    if (currentChunkIndex < audioChunks.length) {
      // Utiliser l'audio déjà généré
      if (generatedAudioUrls[currentChunkIndex]) {
        audioElement.src = generatedAudioUrls[currentChunkIndex];
        await audioElement.play();
        chunkStatuses[currentChunkIndex] = 'playing';
        statusMessage = `Lecture en cours (${currentChunkIndex + 1}/${audioChunks.length})`;
      } else {
        // Attendre que le chunk soit généré
        statusMessage = 'Chargement du prochain segment...';
        
        // Vérifier périodiquement si l'audio est prêt
        const checkInterval = setInterval(() => {
          if (generatedAudioUrls[currentChunkIndex] && audioElement) {
            clearInterval(checkInterval);
            audioElement.src = generatedAudioUrls[currentChunkIndex];
            audioElement.play();
            chunkStatuses[currentChunkIndex] = 'playing';
            statusMessage = `Lecture en cours (${currentChunkIndex + 1}/${audioChunks.length})`;
          }
        }, 100);
      }
    }
  }

  // Générer tous les chunks en arrière-plan
  async function generateAllChunks(): Promise<void> {
    isGeneratingAudio = true;
    
    for (let i = 1; i < audioChunks.length; i++) {
      // Ignorer si déjà généré
      if (generatedAudioUrls[i]) {
        console.log(`⏭️ Chunk ${i + 1} déjà généré, passage au suivant`);
        continue;
      }
      
      try {
        const audioUrl = await generateAudioChunk(audioChunks[i], i);
        console.log(`✅ Chunk ${i + 1}/${audioChunks.length} généré`);
      } catch (err) {
        console.error(`Erreur chunk ${i}:`, err);
      }
    }
    
    isGeneratingAudio = false;
    console.log('✅ Tous les chunks audio générés et sauvegardés');
  }

  // Générer et lire l'audio avec streaming
  async function playAudio(): Promise<void> {
    if (!extractedText) return;

    try {
      if (appState === 'paused' && audioElement) {
        // Reprendre la lecture
        await audioElement.play();
        appState = 'playing';
        return;
      }

      // Si c'est une nouvelle lecture
      if (audioChunks.length === 0) {
        statusMessage = 'Préparation de l\'audio...';
        
        // Diviser le texte en chunks
        audioChunks = splitTextIntoChunks(extractedText, 500);
        console.log(`📦 Texte divisé en ${audioChunks.length} chunks`);
        
        // Générer et lire le premier chunk immédiatement
        currentChunkIndex = 0;
        const firstChunkUrl = await generateAudioChunk(audioChunks[0], 0);
        
        if (audioElement) {
          audioElement.src = firstChunkUrl;
          await audioElement.play();
          appState = 'playing';
          chunkStatuses[0] = 'playing';
          statusMessage = `Lecture en cours (1/${audioChunks.length})`;
        }
        
        // Générer les autres chunks en arrière-plan
        if (audioChunks.length > 1) {
          generateAllChunks();
        }
      } else {
        // Relire depuis le début (réutiliser les audios déjà générés)
        console.log('🔄 Relecture depuis le début (audio déjà généré)');
        currentChunkIndex = 0;
        
        // Réinitialiser les statuts
        chunkStatuses = audioChunks.map((_, i) => {
          if (i === 0) return 'playing';
          if (generatedAudioUrls[i]) return 'ready';
          return 'waiting';
        });
        
        // Utiliser le premier audio déjà généré
        if (audioElement && generatedAudioUrls[0]) {
          audioElement.src = generatedAudioUrls[0];
          await audioElement.play();
          appState = 'playing';
          statusMessage = `Lecture en cours (1/${audioChunks.length})`;
        }
      }

    } catch (err) {
      console.error('Erreur audio:', err);
      statusMessage = 'Erreur: ' + (err as Error).message;
    }
  }

  // Pause
  function pauseAudio(): void {
    if (audioElement) {
      audioElement.pause();
      appState = 'paused';
      statusMessage = 'En pause';
    }
  }

  // Recommencer
  function restart(): void {
    extractedText = '';
    rawOcrText = '';
    statusMessage = '';
    progressPercent = 0;
    
    // Nettoyer les URLs audio (libérer la mémoire)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    
    generatedAudioUrls.forEach(url => {
      if (url) URL.revokeObjectURL(url);
    });
    generatedAudioUrls = [];
    audioQueue = [];
    audioChunks = [];
    currentChunkIndex = 0;
    isGeneratingAudio = false;
    chunkStatuses = [];
    
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    
    initCamera();
  }

  // Fin de lecture d'un chunk
  async function handleAudioEnd(): Promise<void> {
    // Marquer le chunk actuel comme joué
    if (currentChunkIndex >= 0 && currentChunkIndex < chunkStatuses.length) {
      chunkStatuses[currentChunkIndex] = 'played';
    }
    
    // Si ce n'est pas le dernier chunk, lire le suivant
    if (currentChunkIndex < audioChunks.length - 1) {
      await playNextChunk();
    } else {
      // Tous les chunks ont été lus
      appState = 'ready';
      statusMessage = 'Lecture terminée';
    }
  }

  // Gestion des clics gauche (souris uniquement) - PLAY/PAUSE uniquement
  function handleScreenClick(event: MouseEvent | PointerEvent): void {
    // Bloquer les événements tactiles UNIQUEMENT en mode caméra
    if (appState === 'camera' && 'pointerType' in event && event.pointerType === 'touch') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    if (appState === 'camera' && event.type.includes('touch')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Uniquement les clics de souris (pointerType === 'mouse')
    // En mode caméra, le clic gauche ne fait rien (on utilise le clic droit pour scanner)
    if (appState === 'camera') {
      return;
    } else if (appState === 'ready' || appState === 'paused') {
      // En mode ready ou pause, cliquer lance/reprend l'audio
      playAudio();
    } else if (appState === 'playing') {
      // En lecture, cliquer met en pause
      pauseAudio();
    }
  }

  // Fonction pour simuler le clic droit (utilisée par le bouton tactile)
  async function handleRightClickAction(event?: Event): Promise<void> {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    // En mode caméra, le clic droit lance directement le scan
    if (appState === 'camera') {
      startProcessing();
      return;
    }

    // Si on est en lecture/pause/ready, on lance le countdown pour nouvelle page
    if (appState === 'ready' || appState === 'playing' || appState === 'paused') {
      // Nettoyer l'ancien audio
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrl = null;
      }
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
      
      extractedText = '';
      rawOcrText = '';
      progressPercent = 0;
      
      // Nettoyer les chunks audio
      generatedAudioUrls.forEach(url => {
        if (url) URL.revokeObjectURL(url);
      });
      generatedAudioUrls = [];
      audioQueue = [];
      audioChunks = [];
      currentChunkIndex = 0;
      isGeneratingAudio = false;
      chunkStatuses = [];
      
      // Lancer le countdown de 3 secondes
      countdownSeconds = 3;
      statusMessage = `Nouvelle capture dans ${countdownSeconds}s...`;
      
      // Relancer la caméra en arrière-plan
      await initCamera();
      
      // Countdown
      countdownInterval = window.setInterval(() => {
        countdownSeconds--;
        
        if (countdownSeconds > 0) {
          statusMessage = `Nouvelle capture dans ${countdownSeconds}s...`;
        } else {
          // Countdown terminé, lancer la capture
          if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
          }
          countdownSeconds = 0;
          startProcessing();
        }
      }, 1000);
    }
  }

  // Gestion du clic droit pour lancer le scan (en mode caméra) ou nouvelle page
  async function handleContextMenu(event: MouseEvent | PointerEvent): Promise<void> {
    event.preventDefault(); // Empêche le menu contextuel

    // Bloquer les événements tactiles UNIQUEMENT en mode caméra
    if (appState === 'camera' && 'pointerType' in event && event.pointerType === 'touch') {
      event.stopPropagation();
      return;
    }
    
    if (appState === 'camera' && event.type.includes('touch')) {
      event.stopPropagation();
      return;
    }

    // Utiliser la fonction commune
    await handleRightClickAction();
  }

  // ANCIENNE VERSION - gardée pour référence mais pas utilisée
  async function handleContextMenu_OLD(event: MouseEvent | PointerEvent): Promise<void> {
    event.preventDefault(); // Empêche le menu contextuel

    // Bloquer complètement les événements tactiles
    if ('pointerType' in event && event.pointerType === 'touch') {
      event.stopPropagation();
      return;
    }
    
    if (event.type.includes('touch')) {
      event.stopPropagation();
      return;
    }

    // En mode caméra, le clic droit lance directement le scan
    if (appState === 'camera') {
      startProcessing();
      return;
    }

    // Si on est en lecture/pause/ready, on lance le countdown pour nouvelle page
    if (appState === 'ready' || appState === 'playing' || appState === 'paused') {
      // Nettoyer l'ancien audio
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrl = null;
      }
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
      
      extractedText = '';
      rawOcrText = '';
      progressPercent = 0;
      
      // Nettoyer les chunks audio
      generatedAudioUrls.forEach(url => {
        if (url) URL.revokeObjectURL(url);
      });
      generatedAudioUrls = [];
      audioQueue = [];
      audioChunks = [];
      currentChunkIndex = 0;
      isGeneratingAudio = false;
      chunkStatuses = [];
      
      // Lancer le countdown de 3 secondes
      countdownSeconds = 3;
      statusMessage = `Nouvelle capture dans ${countdownSeconds}s...`;
      
      // Relancer la caméra en arrière-plan
      await initCamera();
      
      // Countdown
      countdownInterval = window.setInterval(() => {
        countdownSeconds--;
        
        if (countdownSeconds > 0) {
          statusMessage = `Nouvelle capture dans ${countdownSeconds}s...`;
        } else {
          // Countdown terminé, lancer la capture
          if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
          }
          countdownSeconds = 0;
          startProcessing();
        }
      }, 1000);
    }
  }

  // Améliorer la qualité de l'image pour l'OCR
  async function preprocessImage(imageDataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) return resolve(imageDataUrl);
        
        // Augmenter la résolution
        const scale = 2;
        tempCanvas.width = img.width * scale;
        tempCanvas.height = img.height * scale;
        
        // Appliquer des filtres pour améliorer la lisibilité
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // Augmenter le contraste
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        
        const factor = 1.5; // Facteur de contraste
        const intercept = 128 * (1 - factor);
        
        for (let i = 0; i < data.length; i += 4) {
          data[i] = data[i] * factor + intercept;     // R
          data[i + 1] = data[i + 1] * factor + intercept; // G
          data[i + 2] = data[i + 2] * factor + intercept; // B
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        resolve(tempCanvas.toDataURL('image/jpeg', 1.0));
      };
      
      img.src = imageDataUrl;
    });
  }

  // Diviser l'image
  function splitImageInTwo(imageDataUrl: string): Promise<[string, string]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Canvas error'));
          return;
        }
        
        const halfWidth = Math.floor(img.width / 2);
        
        tempCanvas.width = halfWidth;
        tempCanvas.height = img.height;
        ctx.drawImage(img, 0, 0, halfWidth, img.height, 0, 0, halfWidth, img.height);
        const leftPage = tempCanvas.toDataURL('image/jpeg', 0.95);
        
        ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(img, halfWidth, 0, halfWidth, img.height, 0, 0, halfWidth, img.height);
        const rightPage = tempCanvas.toDataURL('image/jpeg', 0.95);
        
        resolve([leftPage, rightPage]);
      };
      
      img.onerror = () => reject(new Error('Image error'));
      img.src = imageDataUrl;
    });
  }

  // Effect pour la caméra
  $effect(() => {
    if (video && stream && appState === 'camera') {
      video.srcObject = stream;
      video.play().catch(err => console.error('Play error:', err));
    }
  });

  // Cleanup
  $effect(() => {
    return () => {
      if (browser && stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      generatedAudioUrls.forEach(url => {
        if (url) URL.revokeObjectURL(url);
      });
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
    };
  });

  // Démarrer la caméra au chargement
  if (browser) {
    initCamera();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="app" 
  onclick={handleScreenClick} 
  oncontextmenu={handleContextMenu}
>
  <!-- Caméra plein écran -->
  {#if appState === 'camera'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="camera-fullscreen"
      ontouchstart={(e) => { 
        // Autoriser uniquement le bouton flottant
        if (!(e.target as HTMLElement).closest('.floating-scan-button')) {
          e.preventDefault(); 
          e.stopPropagation(); 
        }
      }}
      ontouchend={(e) => { 
        if (!(e.target as HTMLElement).closest('.floating-scan-button')) {
          e.preventDefault(); 
          e.stopPropagation(); 
        }
      }}
      ontouchmove={(e) => { 
        if (!(e.target as HTMLElement).closest('.floating-scan-button')) {
          e.preventDefault(); 
          e.stopPropagation(); 
        }
      }}
    >
      <!-- svelte-ignore a11y_missing_attribute -->
      <video bind:this={video} autoplay playsinline></video>
      <canvas bind:this={canvas} class="hidden"></canvas>
      
      {#if countdownSeconds > 0}
        <div class="countdown-overlay">
          <div class="countdown-circle">
            <span class="countdown-number">{countdownSeconds}</span>
          </div>
          <p class="countdown-text">{statusMessage}</p>
        </div>
      {:else}
        <div class="camera-hint">
          <p class="hint-text">Clic droit pour capturer</p>
        </div>
      {/if}
      
      <div class="version-corner">{APP_VERSION}</div>
    </div>
  {/if}

  <!-- Processing -->
  {#if appState === 'processing'}
    <div class="processing-screen">
      <div class="loader"></div>
      <h2>{statusMessage}</h2>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPercent}%"></div>
      </div>
      <p class="progress-text">{progressPercent}%</p>
    </div>
  {/if}

  <!-- Texte + Lecture -->
  {#if appState === 'ready' || appState === 'playing' || appState === 'paused'}
    <div class="result-screen">
      <div class="header">
        <div class="header-left">
          <h1>Texte extrait</h1>
          <span class="version-badge">{APP_VERSION}</span>
        </div>
        <div class="header-buttons">
          <button 
            class="btn-small" 
            onclick={(e) => { 
              e.stopPropagation(); 
              showDebug = !showDebug; 
            }}
          >
            {showDebug ? 'Masquer debug' : 'Debug'}
          </button>
          <button 
            class="btn-small" 
            onclick={(e) => { 
              e.stopPropagation(); 
              restart(); 
            }}
          >
            Recommencer
          </button>
        </div>
      </div>

      {#if showDebug && debugLeftImage}
        <div class="debug-section">
          <h3>Image capturée</h3>
          <div class="debug-images">
            <div class="debug-image-container">
              <p><strong>Image complète</strong></p>
              <img src={debugLeftImage} alt="Image capturée" />
            </div>
          </div>
          <div class="debug-text">
            <p><strong>Texte extrait par Llama Vision :</strong></p>
            <pre>{rawOcrText}</pre>
          </div>

          {#if audioChunks.length > 0}
            <div class="audio-debug-section">
              <h3>Streaming Audio - État en temps réel</h3>
              <div class="audio-stats">
                <span class="stat-item">Total: {audioChunks.length} segments</span>
                <span class="stat-item">En lecture: {currentChunkIndex + 1}</span>
                <span class="stat-item">Prêts: {chunkStatuses.filter(s => s === 'ready').length}</span>
                <span class="stat-item">En attente: {chunkStatuses.filter(s => s === 'waiting').length}</span>
              </div>

              <div class="chunks-list">
                {#each audioChunks as chunk, index}
                  <div class="chunk-item" data-status={chunkStatuses[index]}>
                    <div class="chunk-header">
                      <span class="chunk-number">Segment {index + 1}</span>
                      <span class="chunk-status">
                        {#if chunkStatuses[index] === 'waiting'}
                          En attente
                        {:else if chunkStatuses[index] === 'generating'}
                          Génération...
                        {:else if chunkStatuses[index] === 'ready'}
                          Prêt
                        {:else if chunkStatuses[index] === 'playing'}
                          En lecture
                        {:else if chunkStatuses[index] === 'played'}
                          Écouté
                        {/if}
                      </span>
                    </div>
                    <div class="chunk-preview">
                      {chunk}
                    </div>
                    <div class="chunk-info">
                      {chunk.length} caractères
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <div class="text-display">
        <p>{extractedText}</p>
      </div>

      <div class="click-hint">
        {#if appState === 'ready'}
          <p class="hint-text">Clic gauche : lire | Clic droit : nouvelle page</p>
          <p class="audio-warning">Audio consomme des tokens • Lecture continue</p>
        {:else if appState === 'playing'}
          <p class="hint-text">Clic gauche : pause | Clic droit : nouvelle page</p>
          {#if isGeneratingAudio}
            <p class="audio-info">Génération des segments suivants...</p>
          {/if}
        {:else if appState === 'paused'}
          <p class="hint-text">Clic gauche : reprendre | Clic droit : nouvelle page</p>
        {/if}
      </div>

      {#if statusMessage}
        <p class="status-small">{statusMessage}</p>
      {/if}
    </div>
  {/if}

  <audio 
    bind:this={audioElement}
    onended={handleAudioEnd}
    class="hidden"
  ></audio>

  <!-- Bouton flottant pour le tactile (uniquement en mode caméra) -->
  {#if appState === 'camera'}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button 
      class="floating-scan-button"
      onclick={(e) => { e.stopPropagation(); handleRightClickAction(e); }}
      ontouchstart={(e) => { e.stopPropagation(); }}
      ontouchend={(e) => { e.stopPropagation(); handleRightClickAction(e); }}
    >
      {countdownSeconds > 0 ? countdownSeconds : '📸'}
    </button>
  {/if}
</div>

<style>
  :root {
    --primary: #06b6d4;
    --primary-dark: #0891b2;
    --primary-light: #22d3ee;
    --primary-lighter: #67e8f9;
    --primary-lightest: #a5f3fc;
    --turquoise: #06b6d4;
    --turquoise-dark: #0891b2;
    --turquoise-light: #22d3ee;
    --turquoise-lighter: #67e8f9;
  }

  .app {
    position: fixed;
    inset: 0;
    background: #000;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    pointer-events: auto;
  }

  * {
    -webkit-tap-highlight-color: transparent;
  }

  .camera-fullscreen {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 40px;
    touch-action: none;
  }

  video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .camera-hint {
    position: relative;
    z-index: 20;
    text-align: center;
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    backdrop-filter: blur(15px);
    padding: 24px 48px;
    border-radius: 16px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 8px 32px rgba(6, 182, 212, 0.4);
  }

  .camera-hint .hint-text {
    color: white;
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: 0.5px;
  }

  .version-corner {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 30;
    font-size: 11px;
    font-weight: 600;
    color: white;
    background: var(--primary);
    backdrop-filter: blur(10px);
    padding: 8px 16px;
    border-radius: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
    letter-spacing: 0.5px;
  }

  .countdown-overlay {
    position: relative;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  .countdown-circle {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    backdrop-filter: blur(20px);
    border: 4px solid white;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 12px 48px rgba(6, 182, 212, 0.6);
  }

  .countdown-number {
    font-size: 72px;
    font-weight: 700;
    color: white;
    text-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .countdown-text {
    font-size: 18px;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    backdrop-filter: blur(15px);
    padding: 16px 36px;
    border-radius: 16px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 8px 32px rgba(6, 182, 212, 0.4);
    letter-spacing: 0.5px;
  }

  .processing-screen {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: linear-gradient(135deg, var(--primary-light) 0%, var(--primary-dark) 100%);
    color: white;
  }

  .loader {
    width: 80px;
    height: 80px;
    border: 8px solid rgba(255, 255, 255, 0.2);
    border-top: 8px solid white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 30px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .processing-screen h2 {
    font-size: 24px;
    margin-bottom: 30px;
    text-align: center;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .progress-bar {
    width: 100%;
    max-width: 400px;
    height: 10px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 16px;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, white 0%, var(--primary-lightest) 100%);
    transition: width 0.3s ease;
    border-radius: 12px;
  }

  .progress-text {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .result-screen {
    width: 100%;
    height: 100%;
    background: white;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    touch-action: auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 28px;
    background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
    color: white;
    box-shadow: 0 4px 16px rgba(6, 182, 212, 0.2);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .header h1 {
    font-size: 26px;
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .version-badge {
    font-size: 11px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.15);
    padding: 6px 14px;
    border-radius: 16px;
    border: 2px solid rgba(255, 255, 255, 0.25);
    letter-spacing: 0.5px;
  }

  .header-buttons {
    display: flex;
    gap: 10px;
  }

  .btn-small {
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.15);
    color: white;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-radius: 12px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.3px;
  }

  .btn-small:hover {
    background: white;
    color: var(--primary);
    border-color: white;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(255, 255, 255, 0.3);
  }

  .btn-small:active {
    transform: translateY(0);
  }

  .text-display {
    flex: 1;
    overflow-y: auto;
    padding: 40px 32px;
    background: #f8fafc;
    touch-action: auto;
    -webkit-overflow-scrolling: touch;
  }

  .text-display p {
    line-height: 1.9;
    font-size: 18px;
    color: #1e293b;
    white-space: pre-wrap;
    max-width: 800px;
    margin: 0 auto;
    font-weight: 400;
  }

  .status-small {
    text-align: center;
    padding: 16px;
    color: #64748b;
    font-size: 14px;
    font-weight: 500;
    background: rgba(6, 182, 212, 0.03);
    border-top: 1px solid rgba(6, 182, 212, 0.08);
  }

  .click-hint {
    text-align: center;
    padding: 24px 32px;
    margin: 0;
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.05) 0%, rgba(8, 145, 178, 0.05) 100%);
    border-top: 2px solid rgba(6, 182, 212, 0.1);
  }

  .hint-text {
    font-size: 16px;
    font-weight: 600;
    color: var(--primary);
    margin: 0 0 12px 0;
    letter-spacing: 0.3px;
  }

  .audio-warning {
    font-size: 13px;
    color: #d97706;
    font-weight: 600;
    margin: 0;
    letter-spacing: 0.2px;
  }

  .audio-info {
    font-size: 13px;
    color: #059669;
    font-weight: 600;
    margin: 8px 0 0 0;
    letter-spacing: 0.2px;
  }

  .hidden {
    display: none;
  }

  .debug-section {
    background: #ecfeff;
    padding: 24px;
    border-bottom: 3px solid var(--turquoise);
    max-height: 600px;
    overflow-y: auto;
  }

  .debug-section h3 {
    margin: 0 0 16px 0;
    color: var(--turquoise-dark);
    font-weight: 600;
    letter-spacing: 0.3px;
    font-size: 18px;
  }

  .debug-images {
    display: flex;
    gap: 20px;
    margin-bottom: 20px;
  }

  .debug-image-container {
    flex: 1;
    text-align: center;
  }

  .debug-image-container p {
    margin-bottom: 10px;
    font-weight: 600;
    color: var(--turquoise-dark);
  }

  .debug-image-container img {
    width: 100%;
    border: 2px solid var(--turquoise);
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
  }

  .debug-text {
    margin-top: 20px;
  }

  .debug-text p {
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--turquoise-dark);
  }

  .debug-text pre {
    background: white;
    padding: 15px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 12px;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--turquoise-lighter);
  }

  .audio-debug-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 2px solid var(--turquoise-lighter);
  }

  .audio-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 20px;
    padding: 16px;
    background: white;
    border-radius: 12px;
    border: 2px solid var(--turquoise-lighter);
  }

  .stat-item {
    font-size: 13px;
    font-weight: 600;
    color: var(--turquoise-dark);
    background: var(--turquoise-lighter);
    padding: 8px 16px;
    border-radius: 8px;
    letter-spacing: 0.3px;
  }

  .chunks-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .chunk-item {
    background: white;
    border-radius: 12px;
    padding: 16px;
    border: 2px solid var(--turquoise-lighter);
    transition: all 0.3s ease;
  }

  .chunk-item[data-status="waiting"] {
    border-color: #cbd5e1;
    opacity: 0.7;
  }

  .chunk-item[data-status="generating"] {
    border-color: var(--turquoise);
    background: linear-gradient(135deg, #ffffff 0%, #f0fdfa 100%);
    box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2);
  }

  .chunk-item[data-status="ready"] {
    border-color: var(--turquoise);
    background: linear-gradient(135deg, #ffffff 0%, #ecfeff 100%);
  }

  .chunk-item[data-status="playing"] {
    border-color: var(--turquoise-dark);
    background: linear-gradient(135deg, var(--turquoise-lighter) 0%, var(--turquoise-light) 100%);
    box-shadow: 0 8px 24px rgba(6, 182, 212, 0.4);
  }

  .chunk-item[data-status="played"] {
    border-color: #10b981;
    background: linear-gradient(135deg, #ffffff 0%, #d1fae5 100%);
    opacity: 0.8;
  }

  .chunk-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .chunk-number {
    font-weight: 700;
    font-size: 14px;
    color: var(--turquoise-dark);
    letter-spacing: 0.3px;
  }

  .chunk-status {
    font-size: 13px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 8px;
    background: var(--turquoise-lighter);
    color: var(--turquoise-dark);
    letter-spacing: 0.2px;
  }

  .chunk-item[data-status="playing"] .chunk-status {
    background: white;
    color: var(--turquoise-dark);
    animation: pulse-status 1.5s infinite;
  }

  @keyframes pulse-status {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .chunk-item[data-status="played"] .chunk-status {
    background: #d1fae5;
    color: #059669;
  }

  .chunk-preview {
    font-size: 13px;
    line-height: 1.6;
    color: #334155;
    margin-bottom: 8px;
    padding: 12px;
    background: rgba(6, 182, 212, 0.05);
    border-radius: 8px;
    border-left: 3px solid var(--turquoise-lighter);
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .chunk-item[data-status="playing"] .chunk-preview {
    background: rgba(255, 255, 255, 0.8);
    border-left-color: var(--turquoise-dark);
    font-weight: 500;
  }

  .chunk-info {
    font-size: 11px;
    color: #64748b;
    font-weight: 500;
    letter-spacing: 0.2px;
  }

  /* Bouton flottant pour le tactile */
  .floating-scan-button {
    position: fixed;
    bottom: 32px;
    right: 32px;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--turquoise) 0%, var(--turquoise-dark) 100%);
    border: 4px solid white;
    box-shadow: 0 8px 32px rgba(6, 182, 212, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    cursor: pointer;
    z-index: 1000;
    transition: all 0.3s ease;
    touch-action: auto;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .floating-scan-button:hover {
    transform: scale(1.1);
    box-shadow: 0 12px 48px rgba(6, 182, 212, 0.6);
  }

  .floating-scan-button:active {
    transform: scale(0.95);
  }

  @media (max-width: 768px) {
    .floating-scan-button {
      bottom: 24px;
      right: 24px;
      width: 64px;
      height: 64px;
      font-size: 28px;
    }
  }
</style>