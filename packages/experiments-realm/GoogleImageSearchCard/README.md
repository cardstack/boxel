# Google Image Search Card

A Boxel card that allows users to search for images using Google's Custom Search API through the `SearchGoogleImagesCommand`.

## Features

- **Search Interface**: Clean, user-friendly search form with query input and max results configuration
- **Image Grid Display**: Responsive grid layout showing search results with thumbnails
- **Image Details**: Shows title, snippet, dimensions, and file size for each image
- **Pagination**: Navigate through multiple pages of results
- **Loading States**: Visual feedback during search operations
- **Error Handling**: Graceful error handling with retry functionality
- **Responsive Design**: Works well on desktop and mobile devices
- **Accessibility**: Proper ARIA labels and keyboard navigation support

## Usage

### Card Fields

- **`searchQuery`** (StringField): The search term to look for images
- **`maxResults`** (NumberField): Maximum number of results to return (1-10, defaults to 10)

### User Interface

1. **Search Form**: Enter your search query and optionally set the maximum number of results
2. **Search Button**: Click to perform the search or press Enter in the search field
3. **Results Display**: Images are shown in a responsive grid with hover effects
4. **Image Cards**: Click on any image to open it in a new tab
5. **Pagination**: Use Previous/Next buttons to navigate through results
6. **Search Info**: Shows total results count and search time

### Example

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "searchQuery": "cute puppies",
      "maxResults": 6,
      "title": "Google Image Search Example"
    },
    "meta": {
      "adoptsFrom": {
        "module": "../google-image-search-card",
        "name": "GoogleImageSearchCard"
      }
    }
  }
}
```

## Technical Details

### Command Integration

The card uses the `SearchGoogleImagesCommand` which:

- Accepts a search query and optional parameters
- Returns structured image data from Google's Custom Search API
- Handles pagination automatically
- Provides error handling and loading states

### Image Data Structure

Each image result contains:

- `title`: Image title
- `imageUrl`: Full-size image URL
- `thumbnailUrl`: Thumbnail image URL
- `contextUrl`: Source page URL
- `width`, `height`: Image dimensions
- `byteSize`: File size in bytes
- `mime`, `fileFormat`: File type information
- `displayLink`: Domain name
- `snippet`: Description text

### Styling

The card uses Boxel UI design tokens for consistent styling:

- Responsive grid layout with CSS Grid
- Hover effects and transitions
- Mobile-friendly design
- Loading spinner animation
- Error state styling

## Dependencies

- `@cardstack/boxel-host/commands/search-google-images`
- `@cardstack/boxel-ui/components`
- `@cardstack/boxel-ui/icons`
- Base Boxel card API and field types

## Browser Compatibility

- Modern browsers with ES6+ support
- CSS Grid support for layout
- Fetch API for network requests
- Local storage for caching (if implemented)

## Performance Considerations

- Images are loaded with `loading="lazy"` for better performance
- Search results are cached by the command system
- Responsive images with proper sizing
- Efficient re-rendering with Glimmer tracking
