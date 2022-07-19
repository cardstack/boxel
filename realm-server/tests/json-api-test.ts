import { module, test, skip } from "qunit";
import supertest, { Test, SuperTest } from "supertest";
import { RealmServer } from "../server";
import { join } from "path";
import { Server } from "http";

module("JSON-API requests", function (hooks) {
  let server: Server;
  let request: SuperTest<Test>;

  hooks.before(function () {
    let app = new RealmServer(
      join(__dirname, "cards"),
      new URL("http://127.0.0.1:4444/")
    ).start();
    server = app.listen(4444);
    request = supertest(server);
  });

  hooks.after(function () {
    server.close();
  });

  test("serves a card request", async function (assert) {
    let response = await request
      .get("/post-1")
      .set("Accept", "application/vnd.api+json");

    assert.strictEqual(response.status, 200, "HTTP 200 status");
    let json = JSON.parse(response.body.toString());
    assert.ok(json.data.meta.lastModified, "lastModified exists");
    delete json.data.meta.lastModified;
    assert.deepEqual(json, {
      data: {
        id: "http://127.0.0.1:4444/post-1",
        type: "card",
        attributes: {
          author: {
            firstName: "Mango",
            lastName: "Abdel-Rahman",
          },
          title: "Things That I Like to Chew on",
          body: "I like to chew on my toys, my bones, and my daddy's nose",
        },
        meta: {
          adoptsFrom: {
            module: "./post.gts",
            name: "Post",
          },
        },
        links: {
          self: "http://127.0.0.1:4444/post-1",
        },
      },
    });
  });

  skip("serves a directory request");
  skip("serves a /_cardsOf request");
  skip("serves a /_typeOf request");
  skip("serves a /_search request");
});
