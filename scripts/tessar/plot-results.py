"""Render the sanitized Tessar checkpoint with Matplotlib (no realm access)."""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--results', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
result = json.loads(Path(args.results).read_text())['connected10x']
target = Path(args.output)
target.mkdir(parents=True, exist_ok=True)

plt.rcParams.update({
    'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
    'axes.spines.right': False, 'svg.hashsalt': 'tessar',
})
fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))
colors = ['#14696b', '#9a6855']
for index, (name, label) in enumerate([
    ('candidate', 'Tessar'), ('reference', 'getCards reference'),
]):
    samples = result[name]['reads']
    seconds = [sample['interactiveMs'] / 1000 for sample in samples]
    axes[0].scatter([index + ((i % 5) - 2) * .035 for i in range(len(seconds))],
                    seconds, color=colors[index], s=25, alpha=.75, label=label)
    middle = sorted(seconds)[len(seconds)//2-1:len(seconds)//2+1]
    median = sum(middle) / len(middle)
    axes[0].plot([index-.2, index+.2], [median, median], color=colors[index], lw=3)
axes[0].set_xticks([0, 1], ['Tessar', 'getCards reference'])
axes[0].set_ylabel('Complete interactive display (seconds)')
axes[0].set_ylim(bottom=0)
axes[0].set_title('20 correct stable-data reads per variant', loc='left', weight='bold')
axes[0].grid(axis='y', alpha=.2)

writes = result['candidate']['writes']
labels = ['Content', 'Transitive', 'Exit', 'Entry', 'Async', 'Unrelated',
          'Insert', 'Delete', 'Reconnect']
seconds = [write['ackToDisplayMs'] / 1000 for write in writes]
axes[1].barh(labels, seconds, color=colors[0])
axes[1].axvline(10, color='#b44736', linestyle='--', lw=1.5)
axes[1].set_xlim(0, 10.8)
axes[1].invert_yaxis()
axes[1].set_xlabel('Acknowledged write → complete display (seconds)')
axes[1].set_title('Tessar: all nine tested mutations pass', loc='left', weight='bold')
axes[1].grid(axis='x', alpha=.2)
fig.suptitle('Tessar · 12,550 fabricated records · DO NOT MERGE', x=.04, ha='left', weight='bold')
fig.text(.04, .02,
         'Reference refresh exceeded 10 s and is disqualified for a freshness-preserving speedup claim.\n'
         'JSON-path diagnostic; full 10× HTML replay failed. Samples are local observations, not a capacity guarantee.',
         fontsize=9, color='#604936')
fig.tight_layout(rect=[.02, .12, .99, .92])
fig.savefig(target / 'tessar-10x-performance.svg', metadata={'Date': None})
fig.savefig(target / 'tessar-10x-performance.png', dpi=160)
plt.close(fig)
