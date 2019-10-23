import { MockFactory } from "./testUtilities/mockFactory";
import { CloudContext } from "./cloudContext";
import { App } from "./app";
import { TestContext } from "./testUtilities/testContext";
import { CloudContextBuilder } from "./testUtilities/cloudContextBuilder";
import { HTTPBindingMiddleware } from "./middleware/httpBindingMiddleware";
import { CloudResponseLike } from "./cloudResponse";

const errorMiddleware = (spy: Function) => async (
  context: CloudContext
): Promise<void> => {
  spy();
  context.send({ error: "Boh!!!!!" }, 400);
};

const handler = MockFactory.createMockHandler();

describe("App", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("when use start middleware chain", async () => {
    const mockMiddleware = MockFactory.createMockMiddleware();

    const app = new App();
    await app.use([mockMiddleware], handler)();
    expect(mockMiddleware).toBeCalled();
    expect(handler).toBeCalled();
  });

  it("when empty middlewares call handler", async () => {
    const app = new App();
    await app.use([], handler)();
    expect(handler).toBeCalled();
  });

  it("not call handler when middleware complete execution", async () => {
    const spyError = jest.fn();
    const app = new App();

    await app.use([errorMiddleware(spyError)], handler)();
    expect(spyError).toBeCalled();
    expect(handler).not.toBeCalled();
  });

  it("can accept multiple requests and rebind arguments", async () => {
    const app = new App();
    const runtimeArgs1 = [
      "arg1",
      "arg2",
    ];

    const runtimeArgs2 = [
      "arg1",
      "arg2",
      "arg3",
    ];

    await app.use([], handler)(runtimeArgs1[0], runtimeArgs1[1]);
    await app.use([], handler)(runtimeArgs2[0], runtimeArgs2[1], runtimeArgs2[2]);

    expect(handler).toBeCalledTimes(2);
  });

  it("handler can run with callbacks", async () => {
    const sendSpy = jest.spyOn(TestContext.prototype, "send");
    const spy = jest.fn();
    const app = new App();

    const handler = (context: CloudContext) => {
      MockFactory.simulateCallback(null, () => {
        MockFactory.simulateCallback(null, () => {
          spy();
          context.send("callback", 200);
        });
      })
    };

    await app.use([], handler)();
    expect(spy).toBeCalled();
    expect(sendSpy).toBeCalledWith("callback", 200);
  });

  it("handler can run with promises", async () => {
    const sendSpy = jest.spyOn(TestContext.prototype, "send");
    const spy = jest.fn();
    const app = new App();

    const handler = async (context: CloudContext) => {
      await MockFactory.simulatePromise();
      await MockFactory.simulatePromise();
      spy();
      context.send("promise", 200);
    };

    await app.use([], handler)();
    expect(spy).toBeCalled();
    expect(sendSpy).toBeCalledWith("promise", 200);
  });

  it("handler can run and return void", async () => {
    const sendSpy = jest.spyOn(TestContext.prototype, "send");
    const spy = jest.fn();
    const app = new App();

    const handler = async (context: CloudContext) => {
      spy();
      context.send("void", 200);
    };

    await app.use([], handler)();
    expect(spy).toBeCalled();
    expect(sendSpy).toBeCalledWith("void", 200);
  });

  it("unwraps all post-middleware calls successfully", async () => {
    const app = new App();
    const handler = MockFactory.createMockHandler();
    const postHandlerSpy = jest.fn();

    const postHandlerMiddleware = MockFactory.createMockMiddleware(async (context: CloudContext, next: Function) => {
      await next();
      postHandlerSpy();
    });

    await app.use([postHandlerMiddleware], handler)();

    expect(postHandlerSpy).toBeCalled();
  });

  it("ensure context.flush() is always called even if error occurred", async () => {
    const flushSpy = jest.spyOn(TestContext.prototype, "flush");
    const app = new App();
    const middleware = MockFactory.createMockMiddleware(() => { throw new Error("Ooops!") });
    const handler = MockFactory.createMockHandler();

    try {
      await app.use([middleware], handler)();
    }
    catch (e) {
      // Unhandled error since no exception middleware in this test
    }

    expect(flushSpy).toBeCalled();
  });

  it("multiple requests to same handler get unique instance of context", async () => {
    const requestCount = 10;
    const app = new App();
    const contextInstances: CloudContext[] = [];

    const handler = (context: CloudContext) => {
      contextInstances.push(context);
      context.done();
    }

    for (let i = 0; i < requestCount; i++) {
      await app.use([], handler)();
    }

    expect(contextInstances).toHaveLength(requestCount);

    for (let i = 0; i < requestCount; i++) {
      const current = contextInstances[i];
      const next = contextInstances[i + 1];

      expect(current).not.toBe(next);
    }
  });

  it("Will invoke default registered middleware when handler is executed", async () => {
    const app = new App();

    // Register default middleware
    const defaultMiddleware = MockFactory.createMockMiddleware();
    app.registerMiddleware(defaultMiddleware);

    const handler = MockFactory.createMockHandler();

    await app.use(handler)();

    expect(defaultMiddleware).toBeCalled();
    expect(handler).toBeCalled();
  });

  it("Will invoke default registered middleware and app specific middleware when handler is executed", async () => {
    const app = new App();

    // Register default middleware
    const defaultMiddleware = MockFactory.createMockMiddleware();
    const requestMiddleware = MockFactory.createMockMiddleware();
    app.registerMiddleware(defaultMiddleware);

    const handler = MockFactory.createMockHandler();

    await app.use([requestMiddleware], handler)();

    expect(defaultMiddleware).toBeCalled();
    expect(requestMiddleware).toBeCalled();
    expect(handler).toBeCalled();
  });

  it("Will set response body from async return value of handler function", async () => {
    const app = new App();
    app.registerMiddleware(HTTPBindingMiddleware());

    const expectedBody = {
      foo: "bar"
    };

    const handler = app.use(() => {
      return Promise.resolve(expectedBody);
    });

    const builder = new CloudContextBuilder();
    const context = await builder
      .asHttpRequest()
      .withRequestMethod("GET")
      .invokeHandler(handler);

    expect(context.res).toMatchObject({
      body: expectedBody,
      status: 200
    });
  });

  it("Will set response body from sync return value of handler function", async () => {
    const app = new App();
    app.registerMiddleware(HTTPBindingMiddleware());

    const expectedBody = {
      foo: "bar"
    };

    const handler = app.use(() => {
      return expectedBody;
    });

    const builder = new CloudContextBuilder();
    const context = await builder
      .asHttpRequest()
      .withRequestMethod("GET")
      .invokeHandler(handler);

    expect(context.res).toMatchObject({
      body: expectedBody,
      status: 200
    });
  });

  it("Will set response from sync return of CloudResponse like object from handler function", async () => {
    const app = new App();
    app.registerMiddleware(HTTPBindingMiddleware());

    const expectedBody = {
      foo: "bar"
    };

    const handler = app.use(() => {
      const response = {
        body: expectedBody,
        status: 200,
      };

      return Promise.resolve(response);
    });

    const builder = new CloudContextBuilder();
    const context = await builder
      .asHttpRequest()
      .withRequestMethod("GET")
      .invokeHandler(handler);

    expect(context.res).toMatchObject({
      body: expectedBody,
      status: 200
    });
  });

  it("Will set response from sync return CloudResponse from handler function", async () => {
    const app = new App();
    app.registerMiddleware(HTTPBindingMiddleware());

    const expectedBody: CloudResponseLike = {
      body: { foo: "bar" }
    };

    const handler = app.use(() => {
      const response = {
        body: expectedBody,
        status: 200,
      };

      return response;
    });

    const builder = new CloudContextBuilder();
    const context = await builder
      .asHttpRequest()
      .withRequestMethod("GET")
      .invokeHandler(handler);

    expect(context.res).toMatchObject({
      body: expectedBody,
      status: 200
    });
  });
});
