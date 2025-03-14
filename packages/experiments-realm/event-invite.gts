import { Component, CardDef } from 'https://cardstack.com/base/card-api';

export class EventInvite extends CardDef {
  static displayName = 'Charity Fundraiser Invitation';

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='event-invite'>
        <header class='hero'>
          <div class='overlay'></div>
          <h1>Annual Palm Beach Charity Gala</h1>
          <p class='tagline'>An Evening of Elegance & Impact</p>
        </header>

        <section class='details'>
          <div class='detail-item'>
            <h2>When</h2>
            <img src='https://images.unsplash.com/photo-1518972559570-7cc1309f3229' alt='Calendar' />
            <p>Saturday, September 14th, 2024</p>
            <p>6:30 PM - 11:00 PM</p>
          </div>

          <div class='detail-item'>
            <h2>Where</h2>
            <img src='https://images.unsplash.com/photo-1493612276216-ee3925520721?q=80&w=3308&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D' alt='Location' />
            <p>The Breakers Palm Beach</p>
            <p>One South County Road</p>
            <p>Palm Beach, Florida 33480</p>
          </div>

          <div class='detail-item'>
            <h2>Attire</h2>
            <img src='https://images.unsplash.com/photo-1494790108377-be9c29b29330' alt='Attire' />
            <p>Black Tie</p>
          </div>
        </section>

        <section class='description'>
          <h2>Join Us</h2>
          <img src='https://images.unsplash.com/photo-1522029826125-430d29c71c0a' alt='Gala' />
          <p>
            You are cordially invited to an unforgettable evening of
            philanthropy and refinement at Palm Beach's most prestigious
            charitable event of the year.
          </p>
          <p>
            Experience an exquisite evening featuring gourmet cuisine, live
            entertainment, and a silent auction showcasing extraordinary items,
            all while supporting our community's most vital causes.
          </p>
        </section>

        <section class='philosophy'>
          <h2>Our Philosophy</h2>
          <div class='philosophy-content'>
            <img src='https://images.unsplash.com/photo-1469571486292-0ba58a3f068b' alt='Hands joined in unity' />
            <div class='philosophy-text'>
              <p>
                At the heart of the Palm Beach Charity Gala lies our unwavering 
                commitment to creating meaningful change in our community. We believe 
                that positive transformation happens when compassionate individuals 
                come together with shared purpose.
              </p>
              <p>
                For over two decades, our annual gala has served as a catalyst for 
                social impact, bringing together philanthropists, community leaders, 
                and change-makers. Every contribution, every gesture of support helps 
                weave the fabric of a stronger, more resilient community.
              </p>
            </div>
          </div>
        </section>

        <section class='highlights'>
          <div class='highlight-item'>
            <h3>Cocktail Reception</h3>
            <img src='https://images.unsplash.com/photo-1574006223911-b62431bef4cb' alt='Cocktail' />
            <p>Featuring premium selections and champagne</p>
          </div>
          <div class='highlight-item'>
            <h3>Four-Course Dinner</h3>
            <p>Curated by award-winning chefs</p>
          </div>
          <div class='highlight-item'>
            <h3>Live Entertainment</h3>
            <p>Classical ensemble and jazz quartet</p>
          </div>
        </section>

        <section class='rsvp'>
          <button class='rsvp-button'>RSVP Now</button>
          <p class='deadline'>Kindly respond by August 15th, 2024</p>
        </section>

        <footer>
          <p>For inquiries, please contact</p>
          <p>events@palmbeachgala.org</p>
          <p>(561) 555-0123</p>
        </footer>
      </div>

      <style scoped>
        .event-invite {
          font-family: 'Cormorant Garamond', serif;
          color: #2c3e50;
          max-width: 1200px;
          margin: 0 auto;
        }

        .hero {
          position: relative;
          height: 60vh;
          min-height: 400px;
          background-image: url('https://images.unsplash.com/photo-1519167758481-83f550bb49b3');
          background-size: cover;
          background-position: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          color: white;
          margin-bottom: 4rem;
        }

        .overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.4);
        }

        .hero h1 {
          font-size: 3.5rem;
          margin: 0;
          position: relative;
          z-index: 1;
          font-weight: 300;
          letter-spacing: 2px;
        }

        .tagline {
          font-size: 1.5rem;
          margin-top: 1rem;
          position: relative;
          z-index: 1;
          font-style: italic;
        }

        .details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 2rem;
          padding: 2rem;
          background: #f8f9fa;
          margin-bottom: 4rem;
        }

        .detail-item {
          text-align: center;
        }

        .detail-item h2 {
          color: #b8860b;
          font-size: 1.8rem;
          margin-bottom: 1rem;
          font-weight: 400;
        }

        .description {
          max-width: 800px;
          margin: 0 auto 4rem;
          padding: 0 2rem;
          text-align: center;
          line-height: 1.8;
        }

        .description h2 {
          color: #b8860b;
          font-size: 2.2rem;
          margin-bottom: 1.5rem;
          font-weight: 400;
        }

        .highlights {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 2rem;
          padding: 2rem;
          background: #f8f9fa;
          margin-bottom: 4rem;
        }

        .highlight-item {
          text-align: center;
        }

        .highlight-item h3 {
          color: #b8860b;
          font-size: 1.4rem;
          margin-bottom: 0.5rem;
          font-weight: 400;
        }

        .rsvp {
          text-align: center;
          padding: 4rem 2rem;
          background: linear-gradient(
              rgba(255, 255, 255, 0.9),
              rgba(255, 255, 255, 0.9)
            ),
            url('https://images.unsplash.com/photo-1519167758481-83f550bb49b3');
          background-size: cover;
          background-position: center;
          margin-bottom: 4rem;
        }

        .rsvp-button {
          background: #b8860b;
          color: white;
          border: none;
          padding: 1rem 3rem;
          font-size: 1.2rem;
          cursor: pointer;
          transition: background-color 0.3s;
          font-family: 'Cormorant Garamond', serif;
          letter-spacing: 2px;
        }

        .rsvp-button:hover {
          background: #96700a;
        }

        .deadline {
          margin-top: 1rem;
          font-style: italic;
          color: #666;
        }

        footer {
          text-align: center;
          padding: 2rem;
          background: #2c3e50;
          color: white;
        }

        footer p {
          margin: 0.5rem 0;
        }

        @media (max-width: 768px) {
          .hero h1 {
            font-size: 2.5rem;
          }

          .tagline {
            font-size: 1.2rem;
          }

          .details,
          .highlights {
            grid-template-columns: 1fr;
          }
        }

        .details img,
        .description img,
        .highlights img {
          max-width: 100%;
          height: auto;
          margin-bottom: 1rem;
          border-radius: 8px;
        }

        .philosophy {
          max-width: 1000px;
          margin: 0 auto 4rem;
          padding: 2rem;
          background: #fff;
        }

        .philosophy h2 {
          color: #b8860b;
          font-size: 2.2rem;
          text-align: center;
          margin-bottom: 2rem;
          font-weight: 400;
        }

        .philosophy-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          align-items: center;
        }

        .philosophy img {
          width: 100%;
          height: auto;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .philosophy-text {
          line-height: 1.8;
        }

        .philosophy-text p {
          margin-bottom: 1.5rem;
          color: #2c3e50;
        }

        @media (max-width: 768px) {
          .philosophy-content {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };
}