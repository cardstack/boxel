// A fixed-memory amplitude accumulator for producers that don't know how much
// audio is coming.
//
// The batch reduction in `audio-waveform` can divide a known sample count into
// equal windows. A streaming producer can't: it has to place a value into a bar
// before it knows how many values there will be. Guessing the total from a
// header estimate would put the whole tail of a longer-than-expected file into
// the last bar.
//
// So this accumulates into far more buckets than it needs and halves the
// resolution whenever it runs out — the standard doubling histogram. Each fold
// merges adjacent pairs, so a bucket always covers an equal span of the signal
// and memory never grows with duration.

// How many fine buckets to keep per output bar. Higher costs nothing meaningful
// and reduces the boundary error left over from the final fold; 16 puts each
// bar's edge within a sixteenth of a bar of where an exact windowing would have
// placed it.
const OVERSAMPLE = 16;

export class StreamingEnvelope {
  #barCount: number;
  #capacity: number;
  #squareSums: Float64Array;
  #counts: Float64Array;
  // Buckets written so far, including the one currently filling.
  #used = 0;
  // How many units each bucket holds at the current resolution. Doubles on fold.
  #unitsPerBucket = 1;
  // Units already placed into the bucket at `#used - 1`.
  #unitsInCurrent = 0;
  #peak = 0;
  #totalSquareSum = 0;
  #totalCount = 0;

  constructor(barCount: number) {
    this.#barCount = Math.max(1, barCount);
    this.#capacity = this.#barCount * OVERSAMPLE;
    this.#squareSums = new Float64Array(this.#capacity);
    this.#counts = new Float64Array(this.#capacity);
  }

  // Add one indivisible unit of signal: a granule, a fixed-size sample window,
  // whatever the producer measures in. Producers must use a consistent unit, so
  // every bucket covers the same span.
  push(squareSum: number, count: number, peak?: number): void {
    if (count <= 0) {
      return;
    }
    if (this.#unitsInCurrent >= this.#unitsPerBucket || this.#used === 0) {
      if (this.#used >= this.#capacity) {
        this.#fold();
      }
      this.#used++;
      this.#unitsInCurrent = 0;
    }
    let index = this.#used - 1;
    this.#squareSums[index] += squareSum;
    this.#counts[index] += count;
    this.#unitsInCurrent++;
    this.#totalSquareSum += squareSum;
    this.#totalCount += count;
    if (peak !== undefined && peak > this.#peak) {
      this.#peak = peak;
    }
  }

  // Halve the resolution by merging adjacent bucket pairs, so the accumulator
  // can keep going without allocating.
  #fold(): void {
    let merged = Math.ceil(this.#used / 2);
    for (let index = 0; index < merged; index++) {
      let left = index * 2;
      let right = left + 1;
      this.#squareSums[index] =
        this.#squareSums[left]! +
        (right < this.#used ? this.#squareSums[right]! : 0);
      this.#counts[index] =
        this.#counts[left]! + (right < this.#used ? this.#counts[right]! : 0);
    }
    this.#squareSums.fill(0, merged);
    this.#counts.fill(0, merged);
    this.#used = merged;
    this.#unitsPerBucket *= 2;
    // The bucket that was filling is now merged into its partner, so treat the
    // last bucket as full and let the next push open a fresh one.
    this.#unitsInCurrent = this.#unitsPerBucket;
  }

  get peak(): number {
    return this.#peak;
  }

  get overallRms(): number {
    return this.#totalCount > 0
      ? Math.sqrt(this.#totalSquareSum / this.#totalCount)
      : 0;
  }

  get isEmpty(): boolean {
    return this.#used === 0;
  }

  // Fold the fine buckets down to the requested bar count. A bar's value is the
  // RMS across its buckets, weighted by how much signal each holds, so an
  // uneven final bucket doesn't skew the last bar.
  bars(digits = 4): number[] {
    if (this.#used === 0) {
      return [];
    }
    let factor = 10 ** digits;
    let out: number[] = [];
    for (let bar = 0; bar < this.#barCount; bar++) {
      let start = Math.floor((bar * this.#used) / this.#barCount);
      let end = Math.floor(((bar + 1) * this.#used) / this.#barCount);
      if (end <= start) {
        end = Math.min(start + 1, this.#used);
      }
      let squareSum = 0;
      let count = 0;
      for (let index = start; index < end; index++) {
        squareSum += this.#squareSums[index]!;
        count += this.#counts[index]!;
      }
      let value = count > 0 ? Math.sqrt(squareSum / count) : 0;
      out.push(Math.round(value * factor) / factor);
    }
    return out;
  }
}
