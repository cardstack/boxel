import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateField from 'https://cardstack.com/base/date';
import EmailField from 'https://cardstack.com/base/email';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import UrlField from 'https://cardstack.com/base/url';
import { concat } from '@ember/helper';
import { Button } from '@cardstack/boxel-ui/components';
import { currencyFormat, dayjsFormat } from '@cardstack/boxel-ui/helpers';
import { and } from '@cardstack/boxel-ui/helpers';
import TennisIcon from '@cardstack/boxel-icons/tennis-ball';

export class TennisCamp extends CardDef {
  static displayName = 'Manhattan Kids Tennis Camp';
  static icon = TennisIcon;
  static prefersWideFormat = true;

  @field campName = contains(StringField);
  @field tagline = contains(StringField);
  @field description = contains(MarkdownField);
  @field ageRange = contains(StringField);
  @field location = contains(StringField);
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field weeklyPrice = contains(NumberField);
  @field fullSummerPrice = contains(NumberField);
  @field contactEmail = contains(EmailField);
  @field contactPhone = contains(PhoneNumberField);
  @field website = contains(UrlField);
  @field features = contains(MarkdownField);
  @field schedule = contains(MarkdownField);
  @field testimonials = contains(MarkdownField);

  @field title = contains(StringField, {
    computeVia: function (this: TennisCamp) {
      return this.campName ?? 'Manhattan Kids Tennis Camp';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <div class='camp-website'>
          <section class='hero-section'>
            <div class='hero-content'>
              <div class='hero-text'>
                <h1 class='camp-title'>
                  🎾
                  {{if
                    @model.campName
                    @model.campName
                    'Manhattan Kids Tennis Camp'
                  }}
                </h1>
                <p class='hero-tagline'>
                  {{if
                    @model.tagline
                    @model.tagline
                    'Where Young Champions Begin Their Journey!'
                  }}
                </p>
                <div class='age-badge'>
                  Ages
                  {{if @model.ageRange @model.ageRange '5-12'}}
                  • Downtown Manhattan
                </div>
                <div class='hero-buttons'>
                  <Button @kind='primary' @size='large' class='cta-button'>
                    🌟 Enroll Now!
                  </Button>
                  <Button @kind='secondary' @size='large' class='info-button'>
                    📞 Contact Us
                  </Button>
                </div>
              </div>
              <div class='hero-visual'>
                <div class='tennis-ball'>🎾</div>
                <div class='trophy'>🏆</div>
                <div class='medal'>🥇</div>
              </div>
            </div>
          </section>

          <section class='about-section'>
            <div class='section-content'>
              <h2>🌟 About Our Camp</h2>
              {{#if @model.description}}
                <div class='description'>
                  <@fields.description />
                </div>
              {{else}}
                <div class='description'>
                  <p>Welcome to Manhattan's most exciting tennis camp for kids!
                    Our downtown location offers professional instruction in a
                    fun, safe environment where children ages 5-12 can learn
                    tennis fundamentals while making lasting friendships.</p>
                  <p>🎯 <strong>What makes us special:</strong></p>
                  <ul>
                    <li>🏅 Certified junior tennis instructors</li>
                    <li>🎈 Fun games and activities daily</li>
                    <li>🏙️ Prime downtown Manhattan location</li>
                    <li>👥 Small group sizes for personalized attention</li>
                    <li>⭐ Focus on fundamentals and fun!</li>
                  </ul>
                </div>
              {{/if}}
            </div>
          </section>

          <section class='features-section'>
            <div class='section-content'>
              <h2>🎯 What Your Child Will Love</h2>
              {{#if @model.features}}
                <@fields.features />
              {{else}}
                <div class='features-grid'>
                  <div class='feature-card'>
                    <div class='feature-icon'>🎾</div>
                    <h3>Tennis Fundamentals</h3>
                    <p>Learn proper grip, stance, and swing techniques through
                      fun drills and games</p>
                  </div>
                  <div class='feature-card'>
                    <div class='feature-icon'>🎪</div>
                    <h3>Fun Activities</h3>
                    <p>Tennis-themed games, relay races, and creative challenges
                      keep kids engaged</p>
                  </div>
                  <div class='feature-card'>
                    <div class='feature-icon'>👨‍🏫</div>
                    <h3>Expert Coaches</h3>
                    <p>Professional instructors trained specifically in youth
                      tennis development</p>
                  </div>
                  <div class='feature-card'>
                    <div class='feature-icon'>🏆</div>
                    <h3>Achievement Awards</h3>
                    <p>Weekly challenges and awards to celebrate progress and
                      build confidence</p>
                  </div>
                  <div class='feature-card'>
                    <div class='feature-icon'>🌊</div>
                    <h3>Cool Down Time</h3>
                    <p>Hydration breaks, snacks, and quiet activities to keep
                      energy balanced</p>
                  </div>
                  <div class='feature-card'>
                    <div class='feature-icon'>🎨</div>
                    <h3>Creative Play</h3>
                    <p>Tennis-inspired arts and crafts on rainy days and between
                      activities</p>
                  </div>
                </div>
              {{/if}}
            </div>
          </section>

          <section class='schedule-section'>
            <div class='section-content'>
              <h2>📅 Summer Schedule</h2>
              {{#if @model.schedule}}
                <@fields.schedule />
              {{else}}
                <div class='schedule-info'>
                  <div class='date-range'>
                    <h3>🗓️ Camp Dates</h3>
                    <p class='dates'>
                      {{if
                        (and @model.startDate @model.endDate)
                        (concat
                          (dayjsFormat @model.startDate 'MMMM D')
                          ' - '
                          (dayjsFormat @model.endDate 'MMMM D, YYYY')
                        )
                        'June 17 - August 23, 2024'
                      }}
                    </p>
                  </div>
                  <div class='daily-schedule'>
                    <h3>⏰ Daily Schedule</h3>
                    <ul class='schedule-list'>
                      <li><span class='time'>9:00 AM</span>
                        Welcome & Warm-up</li>
                      <li><span class='time'>9:30 AM</span>
                        Tennis Skills & Drills</li>
                      <li><span class='time'>10:30 AM</span>
                        Fun Games & Activities</li>
                      <li><span class='time'>11:15 AM</span>
                        Snack Break & Hydration</li>
                      <li><span class='time'>11:45 AM</span>
                        Match Play & Challenges</li>
                      <li><span class='time'>12:30 PM</span>
                        Cool Down & Awards</li>
                      <li><span class='time'>1:00 PM</span> Pickup Time</li>
                    </ul>
                  </div>
                </div>
              {{/if}}
            </div>
          </section>

          <section class='pricing-section'>
            <div class='section-content'>
              <h2>💰 Pricing & Enrollment</h2>
              <div class='pricing-grid'>
                <div class='pricing-card weekly'>
                  <div class='price-header'>
                    <h3>Weekly Rate</h3>
                    <div class='price'>
                      {{if
                        @model.weeklyPrice
                        (currencyFormat @model.weeklyPrice)
                        '$189'
                      }}
                      <span class='period'>/week</span>
                    </div>
                  </div>
                  <ul class='price-features'>
                    <li>✨ 5 days of tennis fun</li>
                    <li>🎾 All equipment provided</li>
                    <li>🥤 Daily snacks included</li>
                    <li>📸 Weekly progress photos</li>
                  </ul>
                </div>
                <div class='pricing-card full-summer featured'>
                  <div class='best-value'>⭐ BEST VALUE</div>
                  <div class='price-header'>
                    <h3>Full Summer</h3>
                    <div class='price'>
                      {{if
                        @model.fullSummerPrice
                        (currencyFormat @model.fullSummerPrice)
                        '$1,599'
                      }}
                      <span class='period'>/summer</span>
                    </div>
                  </div>
                  <ul class='price-features'>
                    <li>🎯 10 weeks of tennis camp</li>
                    <li>🏆 End-of-summer tournament</li>
                    <li>🎁 Camp t-shirt & water bottle</li>
                    <li>📋 Detailed progress report</li>
                    <li>💫 Certificate of completion</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section class='testimonials-section'>
            <div class='section-content'>
              <h2>💬 What Parents Say</h2>
              {{#if @model.testimonials}}
                <@fields.testimonials />
              {{else}}
                <div class='testimonials-grid'>
                  <div class='testimonial'>
                    <div class='stars'>⭐⭐⭐⭐⭐</div>
                    <p>"My 7-year-old absolutely LOVES this camp! The coaches
                      are amazing and she's learned so much while having a
                      blast."</p>
                    <div class='author'>- Sarah M., Parent</div>
                  </div>
                  <div class='testimonial'>
                    <div class='stars'>⭐⭐⭐⭐⭐</div>
                    <p>"Perfect location in downtown Manhattan. My son has made
                      great friends and his tennis skills have improved
                      dramatically!"</p>
                    <div class='author'>- Michael R., Parent</div>
                  </div>
                  <div class='testimonial'>
                    <div class='stars'>⭐⭐⭐⭐⭐</div>
                    <p>"The coaches make tennis so fun! Even on hot days, the
                      kids are excited to play. Couldn't recommend more highly."</p>
                    <div class='author'>- Jennifer L., Parent</div>
                  </div>
                </div>
              {{/if}}
            </div>
          </section>

          <section class='contact-section'>
            <div class='section-content'>
              <h2>📞 Get Started Today!</h2>
              <div class='contact-grid'>
                <div class='contact-info'>
                  <h3>Contact Information</h3>
                  <div class='contact-item'>
                    <strong>📞 Phone:</strong>
                    {{#if @model.contactPhone}}
                      <@fields.contactPhone @format='atom' />
                    {{else}}
                      <span>(212) 555-TENNIS</span>
                    {{/if}}
                  </div>
                  <div class='contact-item'>
                    <strong>✉️ Email:</strong>
                    {{#if @model.contactEmail}}
                      <@fields.contactEmail @format='atom' />
                    {{else}}
                      <span>info@manhattankidstennis.com</span>
                    {{/if}}
                  </div>
                  <div class='contact-item'>
                    <strong>📍 Location:</strong>
                    <span>{{if
                        @model.location
                        @model.location
                        'Downtown Manhattan Tennis Center'
                      }}</span>
                  </div>
                  {{#if @model.website}}
                    <div class='contact-item'>
                      <strong>🌐 Website:</strong>
                      <@fields.website @format='atom' />
                    </div>
                  {{/if}}
                </div>
                <div class='cta-box'>
                  <h3>Ready to Join?</h3>
                  <p>Spaces fill up fast! Reserve your child's spot today.</p>
                  <Button @kind='primary' @size='large' class='final-cta'>
                    🚀 Enroll Now - Limited Spots!
                  </Button>
                  <p class='guarantee'>30-day happiness guarantee ✅</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style scoped>
        .stage {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            #ff6b6b 0%,
            #4ecdc4 25%,
            #45b7d1 50%,
            #96ceb4 75%,
            #feca57 100%
          );
          background-size: 400% 400%;
          animation: gradientShift 15s ease infinite;
        }

        @keyframes gradientShift {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }

        .camp-website {
          max-width: 1200px;
          margin: 0 auto;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 20px;
          overflow-y: auto;
          max-height: 100%;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        }

        /* Hero Section */
        .hero-section {
          background: linear-gradient(135deg, #ff6b6b, #4ecdc4);
          color: white;
          padding: 3rem 2rem;
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .hero-content {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 2rem;
          align-items: center;
        }

        .camp-title {
          font-size: 3rem;
          font-weight: 800;
          margin: 0 0 1rem 0;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .hero-tagline {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 1.5rem 0;
          opacity: 0.95;
        }

        .age-badge {
          display: inline-block;
          background: rgba(255, 255, 255, 0.9);
          color: #333;
          padding: 0.8rem 1.5rem;
          border-radius: 25px;
          font-weight: 700;
          font-size: 1.1rem;
          margin-bottom: 2rem;
        }

        .hero-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }

        .cta-button,
        .final-cta {
          background: #ff6b6b !important;
          border: none !important;
          color: white !important;
          font-weight: 700 !important;
          padding: 1rem 2rem !important;
          border-radius: 50px !important;
          font-size: 1.1rem !important;
          transform: scale(1);
          transition: all 0.3s ease;
        }

        .cta-button:hover,
        .final-cta:hover {
          transform: scale(1.05);
          box-shadow: 0 8px 24px rgba(255, 107, 107, 0.4);
        }

        .info-button {
          background: rgba(255, 255, 255, 0.9) !important;
          color: #333 !important;
          border: 2px solid white !important;
          font-weight: 600 !important;
        }

        .hero-visual {
          position: relative;
          height: 200px;
        }

        .tennis-ball,
        .trophy,
        .medal {
          position: absolute;
          font-size: 4rem;
          animation: float 3s ease-in-out infinite;
        }

        .tennis-ball {
          top: 20%;
          left: 30%;
          animation-delay: 0s;
        }

        .trophy {
          top: 60%;
          left: 10%;
          animation-delay: 1s;
        }

        .medal {
          top: 40%;
          right: 20%;
          animation-delay: 2s;
        }

        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }

        /* Section Styling */
        section {
          padding: 3rem 2rem;
        }

        .section-content {
          max-width: 1000px;
          margin: 0 auto;
        }

        section h2 {
          font-size: 2.5rem;
          font-weight: 800;
          text-align: center;
          margin: 0 0 2rem 0;
          background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* Features Grid */
        .features-section {
          background: #f8fafc;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .feature-card {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          text-align: center;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.08);
          transition:
            transform 0.3s ease,
            box-shadow 0.3s ease;
        }

        .feature-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.15);
        }

        .feature-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .feature-card h3 {
          font-size: 1.4rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: #333;
        }

        .feature-card p {
          color: #666;
          line-height: 1.6;
          margin: 0;
        }

        /* Schedule Section */
        .schedule-info {
          display: grid;
          grid-template-columns: 1fr 2fr;
          gap: 3rem;
        }

        .date-range,
        .daily-schedule {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.08);
        }

        .date-range h3,
        .daily-schedule h3 {
          margin: 0 0 1.5rem 0;
          font-size: 1.5rem;
          font-weight: 700;
          color: #333;
        }

        .dates {
          font-size: 1.3rem;
          font-weight: 600;
          color: #ff6b6b;
          margin: 0;
        }

        .schedule-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .schedule-list li {
          padding: 0.8rem 0;
          border-bottom: 1px solid #eee;
          display: flex;
          align-items: center;
        }

        .schedule-list li:last-child {
          border-bottom: none;
        }

        .time {
          background: #4ecdc4;
          color: white;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
          margin-right: 1rem;
          min-width: 80px;
          text-align: center;
        }

        /* Pricing Section */
        .pricing-section {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
          gap: 2rem;
        }

        .pricing-card {
          background: rgba(255, 255, 255, 0.95);
          color: #333;
          padding: 2rem;
          border-radius: 20px;
          position: relative;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          transition: transform 0.3s ease;
        }

        .pricing-card:hover {
          transform: translateY(-8px);
        }

        .pricing-card.featured {
          border: 3px solid #feca57;
          transform: scale(1.05);
        }

        .best-value {
          position: absolute;
          top: -15px;
          left: 50%;
          transform: translateX(-50%);
          background: #feca57;
          color: #333;
          padding: 0.5rem 1.5rem;
          border-radius: 20px;
          font-weight: 700;
          font-size: 0.9rem;
        }

        .price-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .price-header h3 {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
        }

        .price {
          font-size: 3rem;
          font-weight: 800;
          color: #ff6b6b;
          margin: 0;
        }

        .period {
          font-size: 1.2rem;
          color: #666;
          font-weight: 400;
        }

        .price-features {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .price-features li {
          padding: 0.8rem 0;
          border-bottom: 1px solid #eee;
          font-weight: 500;
        }

        .price-features li:last-child {
          border-bottom: none;
        }

        /* Testimonials */
        .testimonials-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 2rem;
        }

        .testimonial {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.08);
          text-align: center;
        }

        .stars {
          font-size: 1.5rem;
          margin-bottom: 1rem;
        }

        .testimonial p {
          font-style: italic;
          line-height: 1.6;
          margin: 0 0 1rem 0;
          color: #555;
        }

        .author {
          font-weight: 600;
          color: #4ecdc4;
        }

        /* Contact Section */
        .contact-section {
          background: #f8fafc;
        }

        .contact-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3rem;
        }

        .contact-info h3,
        .cta-box h3 {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0 0 1.5rem 0;
          color: #333;
        }

        .contact-item {
          margin-bottom: 1rem;
          font-size: 1.1rem;
        }

        .contact-item strong {
          display: inline-block;
          width: 100px;
          color: #555;
        }

        .cta-box {
          background: white;
          padding: 2rem;
          border-radius: 15px;
          text-align: center;
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.08);
        }

        .cta-box p {
          margin: 0 0 1.5rem 0;
          color: #666;
        }

        .guarantee {
          font-size: 0.9rem;
          font-weight: 600;
          color: #4ecdc4 !important;
          margin-top: 1rem !important;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .hero-content {
            grid-template-columns: 1fr;
            text-align: center;
          }

          .camp-title {
            font-size: 2rem;
          }

          .hero-tagline {
            font-size: 1.2rem;
          }

          .schedule-info {
            grid-template-columns: 1fr;
          }

          .contact-grid {
            grid-template-columns: 1fr;
          }

          section {
            padding: 2rem 1rem;
          }
        }
      </style>
    </template>
  };
}
