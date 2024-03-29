import { createAsyncThunk } from "@reduxjs/toolkit";
import { v4 as uuid } from "uuid";

import { deleteFlow, getFlow, getPreviews, openDatabase, putFlow, putPreview } from "@/misc/db";

const initDatabase = createAsyncThunk("db/init", async (_, { dispatch, getState }) => {
  dispatch({ type: "database/clear-error" });
  const state = getState();
  if (state.database.status !== "open") {
    return await openDatabase(dispatch);
  }
});

const fetchPreviews = createAsyncThunk("db/previews", async (_, { dispatch }) => {
  dispatch({ type: "database/clear-error" });

  try {
    let previews = await getPreviews();
    previews = previews.map((preview) => ({
      ...preview,
      img: preview.img && URL.createObjectURL(preview.img),
    }));
    dispatch({ type: "database/dirty", payload: false });

    return previews;
  } catch (error) {
    dispatch({
      type: "toast/set",
      payload: { type: "error", message: "Failed to fetch previews" },
    });
    return [];
  }
});

const fetchPreview = createAsyncThunk("db/preview", async (id, { dispatch }) => {
  dispatch({ type: "database/clear-error" });

  try {
    let previews = await getPreviews();
    let preview = previews.find((p) => p.id === id);
    preview = {
      ...preview,
      img: preview.img && URL.createObjectURL(preview.img),
    };
    dispatch({ type: "database/dirty", payload: false });

    return preview;
  } catch (error) {
    dispatch({
      type: "toast/set",
      payload: { type: "error", message: "Failed to fetch preview" },
    });
    return [];
  }
});

const saveFlow = createAsyncThunk("db/save-flow", async ({ id, flow, preview }, { dispatch }) => {
  dispatch({ type: "database/clear-error" });
  try {
    let flowId = id;
    if (!flowId) flowId = uuid();

    await putFlow(flowId, flow, preview);
    dispatch({ type: "database/dirty", payload: true });
    return flowId;
  } catch (error) {
    console.log(error);
    dispatch({
      type: "toast/set",
      payload: { type: "error", message: "Failed to save/create flow" },
    });
    return null;
  }
});

const updatePreview = createAsyncThunk(
  "db/update-preview",
  async ({ id, preview }, { dispatch }) => {
    dispatch({ type: "database/clear-error" });
    try {
      await putPreview(id, preview);
      dispatch({ type: "database/dirty", payload: true });
    } catch (error) {
      console.log(error);
      dispatch({
        type: "toast/set",
        payload: { type: "error", message: "Failed to update preview" },
      });
      return null;
    }
  }
);

const fetchFlow = createAsyncThunk("db/flow", async (id, { dispatch }) => {
  dispatch({ type: "database/clear-error" });
  try {
    let flow = await getFlow(id);
    if (flow) {
      return URL.createObjectURL(flow);
    }
    return flow;
  } catch (error) {
    dispatch({
      type: "toast/set",
      payload: { type: "error", message: "Failed to load flow" },
    });
    return null;
  }
});

const removeFlow = createAsyncThunk("db/remove-flow", async ({ id, name }, { dispatch }) => {
  dispatch({ type: "database/clear-error" });
  try {
    await deleteFlow(id);
    dispatch({ type: "database/dirty", payload: true });
    dispatch({
      type: "toast/set",
      payload: { type: "success", message: `Flow ${name} successfully deleted` },
    });
    return true;
  } catch (error) {
    dispatch({
      type: "toast/set",
      payload: { type: "error", message: "Failed to delete flow" },
    });
    return false;
  }
});

export {
  initDatabase,
  fetchPreviews,
  fetchPreview,
  updatePreview,
  saveFlow,
  fetchFlow,
  removeFlow,
};
