# Getting Started with GPT Boxel Component Creator

This Python application uses OpenAI's GPT models to create Boxel components based on Glimmer templates in Ember. The app generates code for the components, sample JSON data to populate them, and optional CSS styling.

It will create new demo-cards.

## Prerequisites

1. Python 3.7 or higher
2. Streamlit
3. Diskcache
4. OpenAI Python library
5. Boxel realms running

## Installation

1. Clone the repository or download the code.
2. Create a virtual environment and activate it:
   ```
   python -m venv venv
   source venv/bin/activate  # for Linux/Mac
   venv\Scripts\activate  # for Windows
   ```
3. Install the required packages:
   ```
   pip install -r requirements.txt
   ```

## Setup

1. Obtain an API key for OpenAI's GPT models and set it as an environment variable. Replace `your_api_key` with your actual API key.

   ```
   export OPENAI_API_KEY=your_api_key  # for Linux/Mac
   set OPENAI_API_KEY=your_api_key  # for Windows
   ```

2. Run the Streamlit app:

   ```
   streamlit run app.py
   ```

3. Open the app in your browser at http://localhost:8501.

4. Run a base realm in `../realm-server`

   ```
   cd ../realm-server
   pnpm start:base
   ```

5. Run a realm for the demo cards
   ```
   cd ../realm-server
   pnpm start:demo
   ```

## Usage

1. Choose a GPT model from the dropdown menu. GPT-4 is more expensive and more powerful, but it is not yet available to the public.
2. Enter a filename fragment for the generated component.
3. Provide a component description.
4. Describe a use case for the generated component.
5. (Optional) Check the "Create CSS" checkbox and describe the desired look and feel of the component.
6. Click the "Generate" button.

The app will generate code, sample JSON data, and optional CSS for the component. The output will be saved in a folder under the `creations` directory. You can view the generated code and data on the app's interface. If the component is successfully created, an iframe with the rendered component will be displayed.

## Example

1. Model: `gpt-3.5-turbo`
2. Filename fragment: `todo_list`
3. Component description: `a todo list with checkable items`
4. Use case: `for a busy student to keep track of their assignments`
5. Generate CSS: Checked
6. Style: `light and airy, make it pop`

After clicking "Generate", the app will create a todo list component with checkable items, styled in a light and airy manner.

## Troubleshooting

Sometimes the code does not successfully get submitted.
You can fix the code directly in the demo-cards and submit the example json directly

```
curl -X POST -H "Accept: application/vnd.api+json" -d @creations/myfile/timestamp/data.json http://localhost:4202/
```
