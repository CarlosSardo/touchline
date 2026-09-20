declare module "roundrobin" {
  export default function roundrobin<Value>(
    count: number,
    participants: Value[],
  ): [Value, Value][][];
}
