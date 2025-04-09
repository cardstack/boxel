import { CardDef, Component } from 'https://cardstack.com/base/card-api';
export class BdEventInvite extends CardDef {
  static displayName = "bd-event-invite";

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='matrix-invite'>
        <div class='digital-rain'></div>
        
        <div class='terminal-screen'>
          <div class='glitch-text'>SYSTEM ALERT: PARTY PROTOCOL INITIATED</div>
          
          <h1 class='matrix-title'>YOU HAVE BEEN SELECTED</h1>
          
          <div class='content-container'>
            <div class='welcome-message'>
              <p class='typing-text'>> Initializing Party Sequence...</p>
            </div>
            
            <div class='data-panels'>
              <div class='data-panel'>
                <div class='panel-content'>
                  <h2 class='data-header'>> Temporal Coordinates:</h2>
                  <div class='data-box'>
                    <p class='code-text'>Date: 16.12.2023</p>
                    <p class='code-text'>Time: 1500_hours</p>
                  </div>
                </div>
              </div>
              
              <div class='data-panel'>
                <div class='panel-content'>
                  <h2 class='data-header'>> Spatial Coordinates:</h2>
                  <div class='data-box'>
                    <p class='code-text'>Location: [REDACTED]</p>
                    <p class='code-text'>[Details upon authentication]</p>
                  </div>
                </div>
              </div>
              
              <div class='data-panel'>
                <div class='panel-content'>
                  <h2 class='data-header'>> Response Required:</h2>
                  <div class='data-box'>
                    <p class='code-text'>Deadline: 10.12.2023</p>
                    <button class='matrix-button'>AUTHENTICATE PRESENCE</button>
                  </div>
                </div>
              </div>
            </div>
            
            <div class='footer'>
              <div class='terminal-text'>> End transmission...</div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        @keyframes matrix-rain {
          0% { background-position: 0 0; }
          100% { background-position: 0 1000px; }
        }

        @keyframes glitch {
          0% { transform: none; opacity: 1; }
          7% { transform: skew(-0.5deg, -0.9deg); opacity: 0.75; }
          10% { transform: none; opacity: 1; }
          27% { transform: none; opacity: 1; }
          30% { transform: skew(0.8deg, -0.1deg); opacity: 0.75; }
          35% { transform: none; opacity: 1; }
          52% { transform: none; opacity: 1; }
          55% { transform: skew(-1deg, 0.2deg); opacity: 0.75; }
          50% { transform: none; opacity: 1; }
          72% { transform: none; opacity: 1; }
          75% { transform: skew(0.4deg, 1deg); opacity: 0.75; }
          80% { transform: none; opacity: 1; }
          100% { transform: none; opacity: 1; }
        }

        @keyframes typing {
          from { width: 0; }
          to { width: 100%; }
        }

        .matrix-invite {
          max-width: 800px;
          margin: 20px auto;
          padding: 25px;
          background: #000;
          position: relative;
          font-family: 'Courier New', monospace;
          color: #00a2ff;
          text-shadow: 0 0 5px #00a2ff;
          overflow: hidden;
        }

        .digital-rain {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(0deg, 
            rgba(0, 0, 0, 0.8) 0%,
            rgba(0, 162, 255, 0.1) 50%,
            rgba(0, 0, 0, 0.8) 100%);
          animation: matrix-rain 20s linear infinite;
          pointer-events: none;
          opacity: 0.3;
        }

        .terminal-screen {
          position: relative;
          z-index: 1;
          border: 1px solid #00a2ff;
          padding: 20px;
          background: rgba(0, 0, 0, 0.9);
        }

        .glitch-text {
          font-size: 18px;
          text-transform: uppercase;
          animation: glitch 3s infinite;
          margin-bottom: 20px;
          letter-spacing: 2px;
        }

        .matrix-title {
          font-size: 36px;
          text-align: center;
          margin: 20px 0;
          letter-spacing: 5px;
          border-bottom: 1px solid #00a2ff;
          padding-bottom: 10px;
        }

        .typing-text {
          overflow: hidden;
          white-space: nowrap;
          margin: 0;
          letter-spacing: 2px;
          animation: typing 3s steps(40, end);
          border-right: 3px solid #00a2ff;
        }

        .data-panels {
          display: flex;
          flex-direction: column;
          gap: 20px;
          margin: 30px 0;
        }

        .data-panel {
          border: 1px solid #00a2ff;
          padding: 15px;
          background: rgba(0, 162, 255, 0.05);
        }

        .data-header {
          font-size: 20px;
          margin-bottom: 10px;
          border-bottom: 1px solid #00a2ff;
          padding-bottom: 5px;
        }

        .data-box {
          padding: 10px;
          background: rgba(0, 162, 255, 0.1);
        }

        .code-text {
          margin: 5px 0;
          font-family: 'Courier New', monospace;
          letter-spacing: 1px;
        }

        .matrix-button {
          background: transparent;
          color: #00a2ff;
          border: 1px solid #00a2ff;
          padding: 10px 20px;
          font-family: 'Courier New', monospace;
          font-size: 16px;
          cursor: pointer;
          margin: 10px auto;
          display: block;
          transition: all 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 2px;
        }

        .matrix-button:hover {
          background: #00a2ff;
          color: #000;
          box-shadow: 0 0 10px #00a2ff;
        }

        .terminal-text {
          border-top: 1px solid #00a2ff;
          padding-top: 10px;
          margin-top: 20px;
          font-style: italic;
          opacity: 0.8;
        }

        .footer {
          margin-top: 20px;
          text-align: center;
        }
      </style>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }



  static fitted = class Fitted extends Component<typeof this> {
    <template></template>
  }
}