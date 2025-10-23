export interface AvataaarsModel {
  topType?: string;
  accessoriesType?: string;
  hairColor?: string;
  facialHairType?: string;
  clotheType?: string;
  eyeType?: string;
  eyebrowType?: string;
  mouthType?: string;
  skinColor?: string;
}

export interface AvataaarsOption {
  value: string;
  label: string;
}

export interface AvataaarsOptions {
  topType: AvataaarsOption[];
  hairColor: AvataaarsOption[];
  eyeType: AvataaarsOption[];
  eyebrowType: AvataaarsOption[];
  mouthType: AvataaarsOption[];
  skinColor: AvataaarsOption[];
  clotheType: AvataaarsOption[];
}

// Avataaars configuration options with comprehensive styling
export const AVATAAARS_OPTIONS: AvataaarsOptions = {
  topType: [
    { value: 'NoHair', label: 'Bald' },
    { value: 'Eyepatch', label: 'Eyepatch' },
    { value: 'Hat', label: 'Hat' },
    { value: 'Hijab', label: 'Hijab' },
    { value: 'Turban', label: 'Turban' },
    { value: 'WinterHat1', label: 'Winter Hat 1' },
    { value: 'WinterHat2', label: 'Winter Hat 2' },
    { value: 'WinterHat3', label: 'Winter Hat 3' },
    { value: 'WinterHat4', label: 'Winter Hat 4' },
    { value: 'LongHairBigHair', label: 'Big Hair' },
    { value: 'LongHairBob', label: 'Bob Cut' },
    { value: 'LongHairBun', label: 'Hair Bun' },
    { value: 'LongHairCurly', label: 'Curly Hair' },
    { value: 'LongHairCurvy', label: 'Curvy Hair' },
    { value: 'LongHairDreads', label: 'Dreadlocks' },
    { value: 'LongHairFro', label: 'Afro' },
    { value: 'LongHairFroBand', label: 'Afro with Band' },
    { value: 'LongHairNotTooLong', label: 'Medium Hair' },
    { value: 'LongHairShavedSides', label: 'Shaved Sides' },
    { value: 'LongHairMiaWallace', label: 'Mia Wallace' },
    { value: 'LongHairStraight', label: 'Straight Hair' },
    { value: 'LongHairStraight2', label: 'Straight Hair 2' },
    { value: 'LongHairStraightStrand', label: 'Hair Strand' },
    { value: 'ShortHairDreads01', label: 'Short Dreads 1' },
    { value: 'ShortHairDreads02', label: 'Short Dreads 2' },
    { value: 'ShortHairFrizzle', label: 'Frizzled Hair' },
    { value: 'ShortHairShaggyMullet', label: 'Shaggy Mullet' },
    { value: 'ShortHairShortCurly', label: 'Short Curly' },
    { value: 'ShortHairShortFlat', label: 'Short Flat' },
    { value: 'ShortHairShortRound', label: 'Short Round' },
    { value: 'ShortHairShortWaved', label: 'Short Waved' },
    { value: 'ShortHairSides', label: 'Hair Sides' },
    { value: 'ShortHairTheCaesar', label: 'Caesar Cut' },
    { value: 'ShortHairTheCaesarSidePart', label: 'Caesar Side Part' },
  ],
  hairColor: [
    { value: 'Auburn', label: 'Auburn' },
    { value: 'Black', label: 'Black' },
    { value: 'Blonde', label: 'Blonde' },
    { value: 'BlondeGolden', label: 'Golden Blonde' },
    { value: 'Brown', label: 'Brown' },
    { value: 'BrownDark', label: 'Dark Brown' },
    { value: 'PastelPink', label: 'Pastel Pink' },
    { value: 'Blue', label: 'Blue' },
    { value: 'Platinum', label: 'Platinum' },
    { value: 'Red', label: 'Red' },
    { value: 'SilverGray', label: 'Silver Gray' },
  ],
  eyeType: [
    { value: 'Close', label: 'Closed' },
    { value: 'Cry', label: 'Crying' },
    { value: 'Default', label: 'Default' },
    { value: 'Dizzy', label: 'Dizzy' },
    { value: 'EyeRoll', label: 'Eye Roll' },
    { value: 'Happy', label: 'Happy' },
    { value: 'Hearts', label: 'Hearts' },
    { value: 'Side', label: 'Side Glance' },
    { value: 'Squint', label: 'Squint' },
    { value: 'Surprised', label: 'Surprised' },
    { value: 'Wink', label: 'Wink' },
    { value: 'WinkWacky', label: 'Wacky Wink' },
  ],
  eyebrowType: [
    { value: 'Angry', label: 'Angry' },
    { value: 'AngryNatural', label: 'Angry Natural' },
    { value: 'Default', label: 'Default' },
    { value: 'DefaultNatural', label: 'Default Natural' },
    { value: 'FlatNatural', label: 'Flat Natural' },
    { value: 'RaisedExcited', label: 'Raised Excited' },
    { value: 'RaisedExcitedNatural', label: 'Raised Excited Natural' },
    { value: 'SadConcerned', label: 'Sad Concerned' },
    { value: 'SadConcernedNatural', label: 'Sad Concerned Natural' },
    { value: 'UnibrowNatural', label: 'Unibrow Natural' },
    { value: 'UpDown', label: 'Up Down' },
    { value: 'UpDownNatural', label: 'Up Down Natural' },
  ],
  mouthType: [
    { value: 'Concerned', label: 'Concerned' },
    { value: 'Default', label: 'Default' },
    { value: 'Disbelief', label: 'Disbelief' },
    { value: 'Eating', label: 'Eating' },
    { value: 'Grimace', label: 'Grimace' },
    { value: 'Sad', label: 'Sad' },
    { value: 'ScreamOpen', label: 'Scream Open' },
    { value: 'Serious', label: 'Serious' },
    { value: 'Smile', label: 'Smile' },
    { value: 'Tongue', label: 'Tongue Out' },
    { value: 'Twinkle', label: 'Twinkle' },
    { value: 'Vomit', label: 'Vomit' },
  ],
  skinColor: [
    { value: 'Tanned', label: 'Tanned' },
    { value: 'Yellow', label: 'Yellow' },
    { value: 'Pale', label: 'Pale' },
    { value: 'Light', label: 'Light' },
    { value: 'Brown', label: 'Brown' },
    { value: 'DarkBrown', label: 'Dark Brown' },
    { value: 'Black', label: 'Black' },
  ],
  clotheType: [
    { value: 'BlazerShirt', label: 'Blazer & Shirt' },
    { value: 'BlazerSweater', label: 'Blazer & Sweater' },
    { value: 'CollarSweater', label: 'Collar Sweater' },
    { value: 'GraphicShirt', label: 'Graphic Shirt' },
    { value: 'Hoodie', label: 'Hoodie' },
    { value: 'Overall', label: 'Overall' },
    { value: 'ShirtCrewNeck', label: 'Crew Neck Shirt' },
    { value: 'ShirtScoopNeck', label: 'Scoop Neck Shirt' },
    { value: 'ShirtVNeck', label: 'V-Neck Shirt' },
  ],
};

// <ui label> = <avataarsUrl param>
export const CATEGORY_MAP: Record<string, keyof AvataaarsOptions> = {
  hair: 'topType',
  eyes: 'eyeType',
  eyebrows: 'eyebrowType',
  mouth: 'mouthType',
  skinTone: 'skinColor',
  clothes: 'clotheType',
  hairColor: 'hairColor',
};

// Default avatar values
export const DEFAULT_AVATAR_VALUES: Required<AvataaarsModel> = {
  topType: 'ShortHairShortFlat',
  accessoriesType: 'Blank',
  hairColor: 'Platinum',
  facialHairType: 'Blank',
  clotheType: 'BlazerShirt',
  eyeType: 'Default',
  eyebrowType: 'Default',
  mouthType: 'Default',
  skinColor: 'Light',
};

// Predefined avatar sets for quick selection
export const PRESET_AVATAR_SETS: {
  name: string;
  model: Required<AvataaarsModel>;
}[] = [
  {
    name: 'Professional',
    model: {
      topType: 'ShortHairShortFlat',
      accessoriesType: 'Blank',
      hairColor: 'BrownDark',
      facialHairType: 'Blank',
      clotheType: 'BlazerShirt',
      eyeType: 'Default',
      eyebrowType: 'Default',
      mouthType: 'Smile',
      skinColor: 'Light',
    },
  },
  {
    name: 'Creative Artist',
    model: {
      topType: 'LongHairCurly',
      accessoriesType: 'Blank',
      hairColor: 'PastelPink',
      facialHairType: 'Blank',
      clotheType: 'GraphicShirt',
      eyeType: 'Happy',
      eyebrowType: 'RaisedExcited',
      mouthType: 'Smile',
      skinColor: 'Tanned',
    },
  },
  {
    name: 'Cool Dude',
    model: {
      topType: 'ShortHairDreads01',
      accessoriesType: 'Blank',
      hairColor: 'Black',
      facialHairType: 'Blank',
      clotheType: 'Hoodie',
      eyeType: 'Squint',
      eyebrowType: 'Default',
      mouthType: 'Serious',
      skinColor: 'DarkBrown',
    },
  },
  {
    name: 'Friendly Teacher',
    model: {
      topType: 'LongHairBob',
      accessoriesType: 'Blank',
      hairColor: 'Blonde',
      facialHairType: 'Blank',
      clotheType: 'CollarSweater',
      eyeType: 'Happy',
      eyebrowType: 'Default',
      mouthType: 'Smile',
      skinColor: 'Light',
    },
  },
  {
    name: 'Tech Enthusiast',
    model: {
      topType: 'ShortHairShortRound',
      accessoriesType: 'Blank',
      hairColor: 'Brown',
      facialHairType: 'Blank',
      clotheType: 'ShirtCrewNeck',
      eyeType: 'Default',
      eyebrowType: 'Default',
      mouthType: 'Default',
      skinColor: 'Pale',
    },
  },
  {
    name: 'Adventurous Spirit',
    model: {
      topType: 'LongHairStraight',
      accessoriesType: 'Blank',
      hairColor: 'Auburn',
      facialHairType: 'Blank',
      clotheType: 'Overall',
      eyeType: 'Surprised',
      eyebrowType: 'RaisedExcited',
      mouthType: 'Twinkle',
      skinColor: 'Brown',
    },
  },
  {
    name: 'Wise Mentor',
    model: {
      topType: 'ShortHairTheCaesar',
      accessoriesType: 'Blank',
      hairColor: 'SilverGray',
      facialHairType: 'Blank',
      clotheType: 'BlazerSweater',
      eyeType: 'Default',
      eyebrowType: 'Default',
      mouthType: 'Serious',
      skinColor: 'Light',
    },
  },
  {
    name: 'Cheerful Friend',
    model: {
      topType: 'LongHairFro',
      accessoriesType: 'Blank',
      hairColor: 'Black',
      facialHairType: 'Blank',
      clotheType: 'ShirtVNeck',
      eyeType: 'Happy',
      eyebrowType: 'Default',
      mouthType: 'Smile',
      skinColor: 'Black',
    },
  },
];

/**
 * Generates the Avataaars URL for a given avatar model
 */
export function getAvataarsUrl(model: AvataaarsModel): string {
  const {
    topType,
    accessoriesType,
    hairColor,
    facialHairType,
    clotheType,
    eyeType,
    eyebrowType,
    mouthType,
    skinColor,
  } = model;

  const params = [
    `topType=${encodeURIComponent(topType || DEFAULT_AVATAR_VALUES.topType)}`,
    `accessoriesType=${encodeURIComponent(accessoriesType || DEFAULT_AVATAR_VALUES.accessoriesType)}`,
    `hairColor=${encodeURIComponent(hairColor || DEFAULT_AVATAR_VALUES.hairColor)}`,
    `facialHairType=${encodeURIComponent(facialHairType || DEFAULT_AVATAR_VALUES.facialHairType)}`,
    `clotheType=${encodeURIComponent(clotheType || DEFAULT_AVATAR_VALUES.clotheType)}`,
    `eyeType=${encodeURIComponent(eyeType || DEFAULT_AVATAR_VALUES.eyeType)}`,
    `eyebrowType=${encodeURIComponent(eyebrowType || DEFAULT_AVATAR_VALUES.eyebrowType)}`,
    `mouthType=${encodeURIComponent(mouthType || DEFAULT_AVATAR_VALUES.mouthType)}`,
    `skinColor=${encodeURIComponent(skinColor || DEFAULT_AVATAR_VALUES.skinColor)}`,
  ];

  return `https://avataaars.io/?${params.join('&')}`;
}

/**
 * Generates a random avatar by selecting random options from each category
 */
export function generateRandomAvatarModel(): AvataaarsModel {
  const randomHair =
    AVATAAARS_OPTIONS.topType[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.topType.length)
    ];
  const randomHairColor =
    AVATAAARS_OPTIONS.hairColor[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.hairColor.length)
    ];
  const randomEyes =
    AVATAAARS_OPTIONS.eyeType[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.eyeType.length)
    ];
  const randomEyebrows =
    AVATAAARS_OPTIONS.eyebrowType[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.eyebrowType.length)
    ];
  const randomMouth =
    AVATAAARS_OPTIONS.mouthType[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.mouthType.length)
    ];
  const randomSkinTone =
    AVATAAARS_OPTIONS.skinColor[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.skinColor.length)
    ];
  const randomClothes =
    AVATAAARS_OPTIONS.clotheType[
      Math.floor(Math.random() * AVATAAARS_OPTIONS.clotheType.length)
    ];

  return {
    topType: randomHair.value,
    accessoriesType: DEFAULT_AVATAR_VALUES.accessoriesType,
    hairColor: randomHairColor.value,
    facialHairType: DEFAULT_AVATAR_VALUES.facialHairType,
    clotheType: randomClothes.value,
    eyeType: randomEyes.value,
    eyebrowType: randomEyebrows.value,
    mouthType: randomMouth.value,
    skinColor: randomSkinTone.value,
  };
}

/**
 * Gets the options for a specific category
 */
export function getCategoryOptions(category: string) {
  const paramName = CATEGORY_MAP[category];
  return AVATAAARS_OPTIONS[paramName] || [];
}

/**
 * Creates a preview URL for an avatar option by applying it to a base model
 */
export function getOptionPreviewUrl(
  baseModel: AvataaarsModel,
  category: string,
  optionValue: string,
): string {
  const previewModel = { ...baseModel };

  switch (category) {
    case 'hair':
      previewModel.topType = optionValue;
      break;
    case 'hairColor':
      previewModel.hairColor = optionValue;
      break;
    case 'eyes':
      previewModel.eyeType = optionValue;
      break;
    case 'eyebrows':
      previewModel.eyebrowType = optionValue;
      break;
    case 'mouth':
      previewModel.mouthType = optionValue;
      break;
    case 'skinTone':
      previewModel.skinColor = optionValue;
      break;
    case 'clothes':
      previewModel.clotheType = optionValue;
      break;
  }

  return getAvataarsUrl(previewModel);
}

/**
 * Gets the current selection value for a category from an avatar model
 */
export function getCurrentSelectionForCategory(
  model: AvataaarsModel,
  category: string,
): string | undefined {
  switch (category) {
    case 'hair':
      return model.topType;
    case 'hairColor':
      return model.hairColor;
    case 'eyes':
      return model.eyeType;
    case 'eyebrows':
      return model.eyebrowType;
    case 'mouth':
      return model.mouthType;
    case 'skinTone':
      return model.skinColor;
    case 'clothes':
      return model.clotheType;
    default:
      return undefined;
  }
}

/**
 * Updates an avatar model with a new option value for a specific category
 */
export function updateAvatarModelForCategory(
  model: AvataaarsModel,
  category: string,
  optionValue: string,
): AvataaarsModel {
  const updatedModel = { ...model };

  switch (category) {
    case 'hair':
      updatedModel.topType = optionValue;
      break;
    case 'hairColor':
      updatedModel.hairColor = optionValue;
      break;
    case 'eyes':
      updatedModel.eyeType = optionValue;
      break;
    case 'eyebrows':
      updatedModel.eyebrowType = optionValue;
      break;
    case 'mouth':
      updatedModel.mouthType = optionValue;
      break;
    case 'skinTone':
      updatedModel.skinColor = optionValue;
      break;
    case 'clothes':
      updatedModel.clotheType = optionValue;
      break;
  }

  return updatedModel;
}

/**
 * Creates a click sound using Web Audio API
 */
export function playClickSound(): void {
  try {
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();

    // Create oscillator for the click sound
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Connect nodes
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Configure the sound - a short, crisp click
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // High frequency for crisp sound
    oscillator.frequency.exponentialRampToValueAtTime(
      400,
      audioContext.currentTime + 0.1,
    );

    // Set volume envelope for a quick click
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01); // Quick attack
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.1,
    ); // Quick decay

    // Play the sound
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (error) {
    console.error('Audio not supported or failed:', error);
  }
}

/**
 * Interface for createRealImage function parameters
 */
export interface CreateRealParams {
  avatar: AvataaarsModel;
  avatarUrl?: string;
  cardInfo?: {
    notes?: string;
  };
  sendRequestCommand: {
    execute: (input: {
      url: string;
      method: string;
      requestBody: string;
      headers?: Record<string, string>;
    }) => Promise<{
      response: Response;
    }>;
  };
}

/**
 * Interface for createRealImage result
 */
export interface CreateRealResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

/**
 * Builds AI interpretation cues based on avatar configuration
 */
export function buildAICues(avatarModel: AvataaarsModel): string {
  const cuesList = [];

  // Check mouth type
  if (avatarModel.mouthType === 'Grimace') {
    cuesList.push('- Grimace should show teeth with a stretched mouth');
  }
  if (avatarModel.mouthType === 'Vomit') {
    cuesList.push(
      '- Vomit should be pretending to vomit, as if seeing something revolting',
    );
  }

  // Check hair/top type
  if (avatarModel.topType === 'WinterHat1') {
    cuesList.push('- Winter Hat 1 has sides that covers ears and cheeks');
  }
  if (avatarModel.topType === 'WinterHat2') {
    cuesList.push('- Winter Hat 2 is knit');
  }
  if (avatarModel.topType === 'WinterHat3') {
    cuesList.push('- Winter Hat 3 is a beanie');
  }
  if (avatarModel.topType === 'WinterHat4') {
    cuesList.push('- Winter Hat 4 is a Christmas hat');
  }
  if (avatarModel.topType === 'NoHair') {
    cuesList.push('- nohair is bald');
  }
  if (avatarModel.topType === 'ShortHairSides') {
    cuesList.push(
      '- ShortHairSides person should be 90% bald with male pattern baldness',
    );
  }

  // Check eye type
  if (avatarModel.eyeType === 'Hearts') {
    cuesList.push(
      "- hearts eye: don't draw hearts, just make their eyes big and doe-y with affection and attraction",
    );
  }
  if (avatarModel.eyeType === 'Dizzy') {
    cuesList.push('- dizzy eye should be an overall emotion');
  }

  return cuesList.length > 0
    ? '\n\nAI Interpretation Cues:\n' + cuesList.join('\n')
    : '';
}
