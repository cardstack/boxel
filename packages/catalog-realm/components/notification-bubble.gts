import GlimmerComponent from '@glimmer/component';

export interface NotificationBubbleSignature {
  Args: {
    type?: 'idle' | 'pending' | 'success' | 'error';
    message: string;
  };
}

export default class NotificationBubble extends GlimmerComponent<NotificationBubbleSignature> {
  <template>
    <div class='notification-bubble {{@type}}'>
      {{@message}}
    </div>
    <style scoped>
      .notification-bubble {
        display: inline-block;
        padding: 0.75em 1.25em;
        border-radius: 8px;
        font-size: 1rem;
        font-family: 'Inter', sans-serif;
        background: #f5f7fa;
        color: #2c2c2c;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        margin: 0.5em 0;
        border: 1px solid #e0e4ea;
        transition:
          background 0.2s,
          color 0.2s;
        word-break: break-word;
      }
      .notification-bubble.idle {
        background: #f5f7fa;
        color: #4a5568;
        border-color: #e0e4ea;
      }
      .notification-bubble.pending {
        background: #f3f0ff;
        color: #5b21b6;
        border-color: #c4b5fd;
      }
      .notification-bubble.success {
        background: #e6f9ed;
        color: #1b4d2b;
        border-color: #a7e7c1;
      }
      .notification-bubble.error {
        background: #ffeaea;
        color: #a12626;
        border-color: #f5bcbc;
      }
    </style>
  </template>
}
