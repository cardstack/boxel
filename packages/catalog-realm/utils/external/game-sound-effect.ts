// ═══ Sound Effects Utility for Game Quiz ═══
// Centralized audio system for game feedback

export type GameSoundType =
  | 'click'
  | 'correct'
  | 'wrong'
  | 'complete'
  | 'gameOver';

export class GameSoundEffectUtils {
  /**
   * Play a sound effect using Web Audio API
   */
  static playSound(type: GameSoundType): void {
    try {
      // Create audio context for precise timing
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      switch (type) {
        case 'click':
          this.playClickSound(audioContext);
          break;
        case 'correct':
          this.playSuccessSound(audioContext);
          break;
        case 'wrong':
          this.playFailureSound(audioContext);
          break;
        case 'complete':
          this.playCompletionSound(audioContext);
          break;
        case 'gameOver':
          this.playGameOverSound(audioContext);
          break;
      }
    } catch (e) {
      // Fallback for environments without Web Audio API
      console.log(`Sound: ${type}`);
    }
  }

  /**
   * Play start music - uplifting game intro when quiz begins
   */
  static playStartMusic(): void {
    try {
      // Create audio context for game start music
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      // Uplifting start sequence - major chord progression
      const startSequence = [
        { freq: 261.63, duration: 0.3 }, // C4
        { freq: 329.63, duration: 0.3 }, // E4
        { freq: 392.0, duration: 0.3 }, // G4
        { freq: 523.25, duration: 0.5 }, // C5 - triumphant finish
      ];

      startSequence.forEach((note, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        const startTime = audioContext.currentTime + index * 0.2;

        oscillator.frequency.setValueAtTime(note.freq, startTime);

        // Smooth attack and release
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.12, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(
          0.01,
          startTime + note.duration,
        );

        oscillator.start(startTime);
        oscillator.stop(startTime + note.duration);
      });
    } catch (e) {
      // Fallback for environments without Web Audio API
      console.log('Start music: Game beginning!');
    }
  }

  // Click sound - subtle mechanical feedback
  private static playClickSound(audioContext: AudioContext): void {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Sharp, brief click
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      400,
      audioContext.currentTime + 0.1,
    );

    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.1,
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  }

  //  Success sound - ascending triumph
  private static playSuccessSound(audioContext: AudioContext): void {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Rising victory tone
    oscillator.frequency.setValueAtTime(523, audioContext.currentTime); // C5
    oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1); // E5
    oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2); // G5

    gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.4,
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.4);
  }

  // Failure sound - descending warning
  private static playFailureSound(audioContext: AudioContext): void {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Falling warning tone
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4
    oscillator.frequency.exponentialRampToValueAtTime(
      220,
      audioContext.currentTime + 0.3,
    ); // A3

    gainNode.gain.setValueAtTime(0.12, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.3,
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  }

  // Completion sound - triumphant chord progression with extended fanfare
  private static playCompletionSound(audioContext: AudioContext): void {
    // Extended victory fanfare - don't cut off the sound
    const frequencies = [523, 659, 784, 1047, 523, 1047]; // C5, E5, G5, C6, C5, C6

    frequencies.forEach((freq, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Longer notes for more dramatic effect
      const startTime = audioContext.currentTime + index * 0.25;
      const duration = index < 4 ? 0.6 : 1.2; // Last note is extra long

      oscillator.frequency.setValueAtTime(freq, startTime);

      gainNode.gain.setValueAtTime(0.15, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  }

  // Game over sound - dramatic descending sequence with extended drama
  private static playGameOverSound(audioContext: AudioContext): void {
    // More dramatic descending doom sequence
    const frequencies = [440, 370, 311, 262, 220, 185]; // Extended sequence down to low notes

    frequencies.forEach((freq, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Longer, more dramatic timing
      const startTime = audioContext.currentTime + index * 0.4;
      const duration = 0.8; // Longer sustained notes

      oscillator.frequency.setValueAtTime(freq, startTime);

      // More dramatic volume curve
      gainNode.gain.setValueAtTime(0.18, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  }
}
