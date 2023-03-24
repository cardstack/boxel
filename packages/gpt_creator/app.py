import streamlit as st
import diskcache as dc
import json
import os
import openai
import inflection
import requests
from time import sleep

cache = dc.Cache(".cache")

def cached_openai_request(prompt, system=None):
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    cache_key = json.dumps(messages)
    if cache_key not in cache:
        completion = openai.ChatCompletion.create(model="gpt-3.5-turbo", messages=messages, max_tokens=1500, temperature=0)
        cache[cache_key] = json.dumps(completion.choices[0].message.content)
    return json.loads(cache[cache_key])

def generate_code(component_description):
    example_content = open("../demo-cards/example.gts", "r").read()
    prompt = f"""
    Here is a set of glimmer (ember) templates for creating boxel cards: 
    {example_content}
    Please use this as a starting example,
    and construct a template for a card for 
    {component_description} that a user would see coming to a typical website.
    Think about what usually appears in that section of a page
    how it should be rendered and what the person running the site may want to customise.
    Return only the template code, no extra data, information or examples. Do not render the template.
    
    """
    response = cached_openai_request(prompt)

    return response

def fix(code, error):
    prompt = f"""
    Here is a glimmer (ember) template that creates a {component_description}: 
    {code}
    Please fix the error: {error}
    Return only the code, no extra data, information or examples.
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
    response = cached_openai_request(prompt)
    return response

def generate_json(component_description, code, use_case):
    prompt = f"""
    Here is a glimmer (ember) template that creates a {component_description}: 
    {code}
    Please create JSON to fill the fields with copy that matches the use case: {use_case}
    Return only the JSON, no extra data, information or examples.
    """
    response = cached_openai_request(prompt)
    return json.loads(response)

def extract_component_name(code):
    return code.split("export class ")[1].split(" extends Card")[0]

def submit(code, attributes):
    component_name = extract_component_name(code)
    filename_fragment = inflection.underscore(component_name)
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
                    "name": component_name
                }
            }
        }
    }
    with open("tmp.json", "w") as f:
        f.write(json.dumps(data,
                indent=4))
    # Post the data to localhost:4202 (the ember server) as a json file with a custom accept header
    posted = requests.post("http://localhost:4202/", json=data, headers={"Accept": "application/vnd.api+json"})
    if posted.status_code == 200:
        st.success("Success!")
    else:
        with st.spinner("Fixing..."):
            code = fix(code, posted.text)
            with open("../demo-cards/" + filename, "w") as f:
                f.write(code)
            os.sync()
            posted = requests.post("http://localhost:4202/", json=data, headers={"Accept": "application/vnd.api+json"})
            
    return code, data, posted


st.header("GPT-3.5 Boxel Component Creator")

component_description = st.text_input("Enter a component description", value="a todo list with checkable items")
use_case = st.text_input("Enter a description of how you'd see this used", value="for a busy student to keep track of their assignments")

left, right = st.columns(2)

with left:
    with st.spinner("Generating code..."):
        code = generate_code(component_description)
    with st.spinner("Generating copy..."):
        attributes = generate_json(component_description, code, use_case)
    code, data, submission = submit(code, attributes)
    component_name = extract_component_name(code)
    st.code(code)
    st.json(data)
    if submission.status_code == 201:
        st.balloons()
        st.json(submission.json())
        with right:
            component_id = submission.json()["data"]["id"]
            st.components.v1.iframe(component_id, height=1000)
    else:
        st.error(f"Failed to create component: {submission.status_code}")
        
    st.code(submission.text)

