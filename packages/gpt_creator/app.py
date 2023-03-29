import streamlit as st
import diskcache as dc
import json
import os
import openai
import inflection
import requests
from time import sleep
from pathlib import Path
from datetime import datetime

cache = dc.Cache(".cache")

model_context_lengths = {
    "gpt-3.5-turbo": 4000,
    "gpt-4": 8000,
}

# TODO: figure this out dynamically
EXAMPLE_LENGTH_IN_TOKENS = 1923

def cached_openai_request(prompt, model, system=None):
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    cache_key = model + "-" + json.dumps(messages)
    if cache_key not in cache:
        completion = openai.ChatCompletion.create(
            model=model, messages=messages, max_tokens=model_context_lengths[model] - EXAMPLE_LENGTH_IN_TOKENS, temperature=0
        )
        cache[cache_key] = json.dumps(completion.choices[0].message.content)
    response = json.loads(cache[cache_key])
    # Sometimes the response comes formatted as markdown
    # with a code block. We want to extract the code inside
    for language in ["javascript", "js", "ts", "typescript", "css", "html", "json"]:
        if response.startswith(f"```{language}"):
            response = response.split(f"```{language}")[1].split("```")[0]
    return response


def generate_code(component_description, model):
    example_content = open("example.gts", "r").read()
    prompt = f"""
    Here is a set of glimmer (ember) templates for creating boxel cards: 
    {example_content}
    Please use this as a starting example,
    and construct a template for a card for 
    {component_description} that a user would see coming to a typical website.
    Think about what usually appears in that section of a page
    how it should be rendered and what the person running the site may want to customise.
    Return only the template code, no extra data, information or examples. Do not render the template.
    Remember to import the cards you use individually
    Never iterate over lists with {{{{#each, just insert the fields. For example, if there is a @field myItems = containsMany(...) it can be rendered with:
    <@fields.myItems />
    Do not do this for each item. Just for the containing list.
    Do not use "export default" in your code, just export the class.
    Importable cards from https://cardstack.com/base/ are 
    * BooleanCard
    * StringCard
    * DateCard
    * TextAreaCard
    * DateTimeCard
    * IntegerCard
    """
    response = cached_openai_request(prompt, model)

    return response


def fix(code, error, model, component_description):
    prompt = f"""
    Here is a glimmer (ember) template that creates a {component_description}: 
    {code}
    Please fix the error: {error}
    Return only the code, no extra data, information or examples.
    Do not use "export default" in your code, just export the class.
    Also replace any #each loops with the @field syntax <@fields.listFieldName />
    Here are example imports
    ```
    import {{
    contains,
    field,
    Card,
    Component,
    containsMany,
    relativeTo,
    }} from 'https://cardstack.com/base/card-api';
    import StringCard from 'https://cardstack.com/base/string';
    import TextAreaCard from 'https://cardstack.com/base/text-area';
    import {{ CardContainer, FieldContainer }} from '@cardstack/boxel-ui';
    import {{ startCase }} from 'lodash';
    import {{ eq }} from '@cardstack/boxel-ui/helpers/truth-helpers';
    ```
    """
    print(prompt)
    response = cached_openai_request(prompt, model)
    return response


def css(code, model, component_description, use_case, style):
    prompt = f"""
    Here is a glimmer (ember) template that creates a {component_description}: 
    {code}
    Please creae css for it, for the use case {use_case}, in the style {style}.
    Return only the css, no extra data, information or examples or explanation.
    """
    print(prompt)
    response = cached_openai_request(prompt, model)
    return response


def generate_json(component_description, code, use_case, model):
    prompt = f"""
    Here is a glimmer (ember) template that creates a {component_description}: 
    {code}
    Please create JSON to fill the fields with copy that matches the use case: {use_case}
    Return only the JSON, no extra data, information or examples.
    """
    response = cached_openai_request(prompt, model)
    return json.loads(response)


def extract_component_name(code):
    if "export default" in code:
        return code.split("export default ")[1].split(";")[0]
    elif "export class" in code:
        return code.split("export class ")[1].split(" extends Card")[0]
    else:
        raise Exception("Could not extract component name")


def submit(filename_fragment, code, attributes, model, component_description):
    component_name = extract_component_name(code)
    filename = f"{filename_fragment}.gts"
    with open("../demo-cards/" + filename, "w") as f:
        f.write(code)
    data = {
        "data": {
            "type": "card",
            "attributes": attributes,
            "meta": {
                "adoptsFrom": {
                    "module": f"http://localhost:4202/{filename_fragment}",
                    "name": component_name,
                }
            },
        }
    }
    # Post the data to localhost:4202 (the ember server) as a json file with a custom accept header
    posted = requests.post(
        "http://localhost:4202/",
        json=data,
        headers={"Accept": "application/vnd.api+json"},
    )
    if posted.status_code == 201:
        st.success("Success!")
    else:
        with st.spinner("Fixing..."):
            code = fix(code, posted.text, model, component_description)
            with open("../demo-cards/" + filename, "w") as f:
                f.write(code)
            os.sync()
            posted = requests.post(
                "http://localhost:4202/",
                json=data,
                headers={"Accept": "application/vnd.api+json"},
            )

    return code, data, posted



st.header("GPT Boxel Component Creator")

model = st.selectbox("Choose a model:", ("gpt-3.5-turbo", "gpt-4"))
filename_fragment = st.text_input(
    "What should this be called", value="todo_list"
).lower()
component_description = st.text_input(
    "Enter a component description", value="a todo list with checkable items"
)
use_case = st.text_input(
    "Enter a description of how you'd see this used",
    value="for a busy student to keep track of their assignments",
)
generate_css = st.checkbox("Create CSS")


timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

folder = Path(f"creations/{filename_fragment}/{timestamp}/")
folder.mkdir(parents=True, exist_ok=True)

st.text(f"Your output will be saved in the folder: {folder}")

if generate_css:
    st.text("CSS is not yet automatically loaded into the card")
    style = st.text_input(
        "Describe the look and feel, note this isn't loaded automatically into the card", value="light and airy, make it pop"
    )
if st.button("Generate"):
    left, right = st.columns(2)

    with left:
        with st.spinner("Generating code..."):
            code = generate_code(component_description, model)
            with open(folder / "v1.gts", "w") as f:
                f.write(code)

        with st.spinner("Generating copy..."):
            attributes = generate_json(component_description, code, use_case, model)
        code, data, submission = submit(
            filename_fragment, code, attributes, model, component_description
        )
        with open(folder / "final.gts", "w") as f:
            f.write(code)
        with open(folder / "data.json", "w") as f:
            f.write(json.dumps(data, indent=4))
        if generate_css:
            with st.spinner("Creating CSS"):
                css = css(code, model, component_description, use_case, style)
                with open(folder / "style.css", "w") as f:
                    f.write(css)

        component_name = extract_component_name(code)
        st.text("Final code:")
        st.code(code)
        st.text("Data:")
        st.json(data)
        if generate_css:
            st.text("CSS:")
            st.code(css)
        if submission.status_code == 201:
            st.balloons()
            with right:
                component_id = submission.json()["data"]["id"]
                st.components.v1.iframe(component_id, height=1000)
        else:
            st.error(f"Failed to create component: {submission.status_code}")
            st.code(submission.text)
