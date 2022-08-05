const Duck1 = '/images/brett-jordan-wF7GqWA3Tag-unsplash.jpg';
const Duck2 = '/images/jason-richard-VTvnoNBowZs-unsplash.jpg';
const Duck3 = '/images/s-tsuchiya-_WjhfEzRDak-unsplash.jpg';
const Duck4 = '/images/timothy-dykes-LhqLdDPcSV8-unsplash.jpg';

export default {
  model: {
    images: [
      {
        path: Duck1,
        attribution: 'Photo by Brett Jordan on Unsplash (@brett_jordan)',
      },
      {
        path: Duck2,
        attribution: 'Photo by Jason Richard on Unsplash (@jasonthedesigner)',
      },
      {
        path: Duck3,
        attribution: 'Photo of a duck by S. Tsuchiya on Unsplash (@s_tsuchiya)',
      },
      {
        path: Duck4,
        attribution: 'Photo by Timothy Dykes on Unsplash (@timothycdykes)',
      },
    ],
  },
  suggestions: ['form'],
};
