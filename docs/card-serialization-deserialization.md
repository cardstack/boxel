# Card Serialization and Deserialization

Card Serialization and Deserialization are essential processes that ensure a seamless transformation of card data between JSON format and actual card instances. We persistently store card data on the Realm server in two files: the card data is stored in a `.json` file, while the definition or class of the card is stored in a `.gts` file. Within the `.json` file, there is an `adoptFrom` field, where the value represents the path to the `.gts` file. These files are then accessed by the browser through the Realm server and served to the user.

The process of converting the `.json` and `.gts` files into card instances within the browser is known as deserialization. Users can update the card via the browser, and subsequently, the browser will write these updates back to the Realm server by converting the card instances back to JSON, this process is known as serialization.

## Card Serialization

In the serialization process, we transform a card instance into a JSON object. This is achieved by gathering all the values of the card instance's fields from the data bucket.

The central function employed in this process is `serializeCard`. This function takes a card instance as input and generates a `LooseSingleCardDocument` object, which can be directly converted into a JSON representation.

## Card Deserialization

In the deserialization process, we convert JSON data into a card instance. This enables the browser to utilize the instance for rendering a component to be presented to the user.

We employ the `createFromSerialized` function for this purpose. This function triggers the creation of a card instance by retrieving the stored `.gts` file, which is accessible through the `adoptsFrom` field of the `LooseCardResource`. Subsequently, we iterate through the fields of the card instance and retrieve the value of each field from the `LooseCardResource`, storing it in the data bucket. During this process, we also execute the `computateVia` function to obtain the value for any computed fields.



