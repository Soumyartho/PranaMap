import { getMeta, setMeta } from "@/models/db";
import { uuidv7 } from "@/utils/id";

/** A stable ID for this phone, so the server can trace (and revoke) a device. */
export async function getDeviceId(): Promise<string> {
  let id = await getMeta<string>("device_id");
  if (!id) {
    id = `web-${uuidv7()}`;
    await setMeta("device_id", id);
  }
  return id;
}
