import { createMemoryStore } from "../../../test/memoryStore";
import { isFirstCard } from "../firstCard";

const one = async () => 1;
const many = async () => 14;

test("the first card on a new account is the first card", async () => {
  expect(await isFirstCard(createMemoryStore(), "u1", one)).toBe(true);
});

test("it is the first card only once, even if the account is emptied and starts again", async () => {
  const store = createMemoryStore();
  expect(await isFirstCard(store, "u1", one)).toBe(true);
  expect(await isFirstCard(store, "u1", one)).toBe(false);
});

test("someone who was already saving (a new version, a new phone) has nothing to celebrate, and is not asked again", async () => {
  const store = createMemoryStore();
  expect(await isFirstCard(store, "u1", many)).toBe(false);
  const total = jest.fn(one);
  expect(await isFirstCard(store, "u1", total)).toBe(false);
  expect(total).not.toHaveBeenCalled();
});

test("it is remembered per person", async () => {
  const store = createMemoryStore();
  expect(await isFirstCard(store, "u1", one)).toBe(true);
  expect(await isFirstCard(store, "u2", one)).toBe(true);
});

test("if the count can't be read, there is no celebration and nothing is remembered", async () => {
  const store = createMemoryStore();
  const broken = async () => {
    throw new Error("offline");
  };
  expect(await isFirstCard(store, "u1", broken)).toBe(false);
  expect(await isFirstCard(store, "u1", one)).toBe(true);
});
