// Just as a spike to test module execution, lets get to the point where we can
// detect a named export of "component" and render it.
// (actual cards and their API will come after that)

const message: string = "Hello world I'm GTS";
export const component = <template>{{message}}</template>