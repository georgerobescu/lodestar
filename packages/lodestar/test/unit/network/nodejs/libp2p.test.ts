import {assert} from "chai";
import {NodejsNode} from "../../../../src/network/nodejs";
import {createNode} from "../util";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] nodejs libp2p", () => {
  it("can start and stop a node", async () => {
    const node: NodejsNode = await createNode(multiaddr);
    await node.start();
    assert.equal(node.isStarted(), true);
    await node.stop();
    assert.equal(node.isStarted(), false);
  });
  it.only("can connect/disconnect to a peer", async function ()  {
    this.timeout(5000 * 100);
    for (let i = 0; i < 100; i++) {
      // setup
      const nodeA: NodejsNode = await createNode(multiaddr);
      const nodeB: NodejsNode = await createNode(multiaddr);
  
      await Promise.all([
        nodeA.start(),
        nodeB.start(),
      ]);
  
      // connect
      await Promise.all(
        [
          new Promise((resolve, reject) => {
            const t = setTimeout(reject, 1000, '!!! connect timed out');
            nodeB.once("peer:connect", () => {
              clearTimeout(t);
              resolve();
            });
          }),
          nodeA.dial(nodeB.peerInfo),
        ]
      );
  
      // test connection
      // @ts-ignore
      assert(nodeA.registrar.getConnection(nodeB.peerInfo));
      // @ts-ignore
      assert(nodeB.registrar.getConnection(nodeA.peerInfo));
  
      // disconnect
      const p = new Promise(resolve => nodeB.once("peer:disconnect", resolve));
      await new Promise(resolve => setTimeout(resolve, 100));
      await nodeA.hangUp(nodeB.peerInfo);
      await p;
  
      // test disconnection
      // @ts-ignore
      assert(!nodeA.registrar.getConnection(nodeB.peerInfo));
      // @ts-ignore
      assert(!nodeB.registrar.getConnection(nodeA.peerInfo));
      // teardown
      await Promise.all([
        nodeA.stop(),
        nodeB.stop()
      ]);
      console.log('@@@ finished connect/disconnect test ', i);
    }
  });
});
