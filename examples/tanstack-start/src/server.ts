// see notes on how to deploy other cloudflare infra here
// https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start

import handler from "@tanstack/react-start/server-entry";

// Export Durable Objects as named exports
// export { MyDurableObject } from "./my-durable-object";

export default {
  fetch: handler.fetch,

  // Handle Queue messages
  //   async queue(batch, env, ctx) {
  //     for (const message of batch.messages) {
  //       console.log("Processing message:", message.body);
  //       message.ack();
  //     }
  //   },

  // Handle Cron Triggers
  //   async scheduled(event, env, ctx) {
  //     console.log("Cron triggered:", event.cron);
  //   },
};
