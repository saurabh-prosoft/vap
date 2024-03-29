import JSZip from "jszip";
import { useContext, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Flow, FlowConnect, Node, Vector } from "flow-connect";
import "@flow-connect/audio";

import styles from "./Editor.module.css";
import {
  fetchFlow,
  fetchPreview,
  initDatabase,
  removeFlow,
  saveFlow,
  updatePreview,
} from "@/store/actions/db";
import Header from "@/components/Header/Header";
import Brand from "@/components/common/Brand/Brand";
import Button from "@/components/common/Button/Button";
import EditorControls from "@/components/EditorControls/EditorControls";
import Library from "@/components/Library/Library";
import Spinner from "@/components/common/Spinner/Spinner";
import Modal from "@/components/common/Modal/Modal";
import { FlowConnectContext } from "@/contexts/flow-connect";
import FlowName from "@/components/common/FlowName/FlowName";
import ContextMenu from "@/components/common/ContextMenu/ContextMenu";
import Properties from "@/components/Properties/Properties";
import SourceSelector from "@/components/SourceSelector/SourceSelector";

const Editor = () => {
  const { id } = useParams();
  const location = useLocation();
  const [saving, setSaving] = useState(false);
  const [loadMsg, setLoadMsg] = useState(null);
  const [state, setState] = useState("stopped");
  const [flow, setFlow] = useState(null);
  const [preview, setPreview] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dispatch = useDispatch();
  const mainEl = useRef(null);
  const { flowConnect, setFlowConnect } = useContext(FlowConnectContext);
  const navigate = useNavigate();
  const currContext = useRef(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [showProps, setShowProps] = useState(null);
  const [srcNode, setSrcNode] = useState(null);
  const uploaderEl = useRef(null);
  const srcSelectorModal = useRef(null);

  const load = async (fc) => {
    let deSerializedFlow = null;
    setState("loading");

    setLoadMsg("Connecting to DB");
    await openDB();

    setLoadMsg("Fetching flow");
    const result = await dispatch(fetchFlow(id));
    const preview = await dispatch(fetchPreview(id));
    setPreview(preview.payload);

    setLoadMsg("Unwrapping");
    if (result.payload) {
      deSerializedFlow = await unwrap(fc ?? flowConnect, result.payload);
      setFlow(deSerializedFlow);
      processNodes(deSerializedFlow);

      setLoadMsg("Rendering");
      (fc ?? flowConnect).render(deSerializedFlow);
    }

    setLoadMsg(null);
    setState("stopped");

    return { prw: preview.payload, flw: deSerializedFlow };
  };
  const unwrap = async (fc, vapPack) => {
    const pack = await (await fetch(vapPack)).blob();
    let zip = new JSZip();
    zip = await zip.loadAsync(pack);
    const serializedFlow = await zip.file("flow.json").async("string");

    return await fc.fromJson(serializedFlow, async (meta) => {
      const blob = await zip.file(`raw/${meta.id}`).async("blob");
      if (meta.rawType === "file") {
        return new File([blob], meta.name, { type: meta.type });
      } else {
        return blob;
      }
    });
  };

  const openDB = async () => {
    await dispatch(initDatabase());
  };

  const handleSave = async () => {
    setSaving(true);

    let prwBlobUrl = null;
    if (flow?.nodes.size !== 0) {
      const ratio = 1385 / 895;
      const height = flowConnect.canvas.width / ratio;
      const prwCanvas = new OffscreenCanvas(flowConnect.canvas.width, height);
      prwCanvas
        .getContext("2d")
        .drawImage(flowConnect.canvas, 0, 0, flowConnect.canvas.width, height);
      const prwBlob = await prwCanvas.convertToBlob();
      prwBlobUrl = URL.createObjectURL(prwBlob);
    }

    const pack = await handleExport();
    const packURL = URL.createObjectURL(pack);
    const prw = await dispatch(fetchPreview(id));
    await dispatch(
      saveFlow({ id, flow: packURL, preview: { name: prw.payload.name, img: prwBlobUrl } })
    );
    prwBlobUrl && URL.revokeObjectURL(prwBlobUrl);
    URL.revokeObjectURL(packURL);

    setSaving(false);
  };
  const handleExport = async (fc, inFlow) => {
    const raw = {};
    const serializedFlow = await (fc ?? flowConnect).toJson(inFlow ?? flow, (id, rw) => {
      let meta = {};
      raw[id] = rw;
      if (rw instanceof File) {
        meta = { name: rw.name, type: rw.type, rawType: "file" };
      }
      return meta;
    });
    const flowBlob = new Blob([serializedFlow], { type: "application/json" });

    let zip = new JSZip();
    zip.file("flow.json", flowBlob);
    Object.keys(raw).forEach((id) => zip.file(`raw/${id}`, raw[id]));
    const pack = await zip.generateAsync({ type: "blob" });

    return pack;
  };
  const handleDownload = async () => {
    const pack = await handleExport();

    const downloader = document.createElement("a");
    document.body.appendChild(downloader);
    downloader.style.display = "none";
    const url = URL.createObjectURL(pack);
    downloader.href = url;
    downloader.download = `${
      id !== "temp" ? preview.name.toLowerCase().replace(" ", "-") : "temp"
    }.vap`;
    downloader.click();
    URL.revokeObjectURL(url);
    downloader.remove();
  };
  const handleDelete = () => {
    if (id !== "temp") {
      dispatch(removeFlow({ id, name: preview.name }));
      navigate("/flows");
    }
  };
  const handlePlay = () => {
    flow.start();
    setState("playing");
  };
  const handleStop = () => {
    flow.stop();
    setState("stopped");
  };
  const handleReplay = () => {
    handleStop();
    handlePlay();
  };
  const handleSelect = (node, pos) => {
    const n = flow.createNode(
      node.type,
      Vector.create(
        pos?.x ?? flowConnect.canvas.width * 0.4,
        pos?.y ?? flowConnect.canvas.height * 0.4
      ),
      node.type === "audio/waveform" ? { style: { waveColor: "#fff" } } : {}
    );

    processNodes(n);
  };
  const handleDrop = (data, pos) => {
    handleSelect({ type: data }, flowConnect.screenToReal(Vector.create(pos)));
  };
  const handleNameUpdate = async (newName) => {
    if (id === "temp") return;

    let img = null;
    if (preview.img) {
      img = await (await fetch(preview.img)).blob();
    }
    dispatch(updatePreview({ id, preview: { ...preview, img, name: newName } }));
  };
  const registerListeners = (fc) => {
    fc = fc ?? flowConnect;

    fc.on("context-menu", (e) => {
      if (e.target instanceof Node && currContext.current !== e.target) {
        currContext.current = e.target;
        setCtxMenu(e.screenPos);
      }
    });

    fc.on("dbl-press", (e) => {
      if (e.target instanceof Node) {
        setShowProps(e.target);
      }
    });
  };
  const handleCtxSelect = (option) => {
    if (option === "Properties") {
      setShowProps(currContext.current);
    } else if (option === "Delete") {
      flow.removeNode(currContext.current);
    }
  };
  const processNodes = (input) => {
    const nodes = [];
    if (input instanceof Flow) {
      [...input.nodes].forEach(([_, val]) => nodes.push(val));
    } else if (input instanceof Node) {
      nodes.push(input);
    }

    nodes
      .filter((node) => ["audio/source", "audio/buffer-source"].includes(node.type))
      .forEach((node) => {
        node.fileInput.actionOverride = true;
        node.fileInput.label.on("click", () => setSrcNode(node));
      });
  };
  const handleSourceSelect = (file) => {
    srcNode.state.file = file;
    srcSelectorModal.current?.close();
  };

  const init = async () => {
    const fc = await FlowConnect.create(mainEl.current);
    setFlowConnect(fc);
    setDefaultStyles(fc);

    if (id !== "temp") {
      const { prw, flw } = await load(fc);
      if (!flw) {
        const newFlow = fc.createFlow({ name: "New Flow", rules: {} });
        const pack = await handleExport(fc, newFlow);
        const flwUrl = URL.createObjectURL(pack);
        await dispatch(saveFlow({ id, flow: flwUrl, preview: prw }));
        setFlow(newFlow);
        fc.render(newFlow);
      }
    } else {
      if (location.state) {
        try {
          const flow = await unwrap(fc, location.state.url);
          setFlow(flow);
          processNodes(flow);
          setPreview({ name: location.state.name });
          fc.render(flow);
        } catch (error) {
          navigate("/flows");
        }
      } else {
        const newFlow = fc.createFlow({ name: "New Flow", rules: {} });
        setFlow(newFlow);
        setPreview({ name: "Empty" });
        fc.render(newFlow);
      }
    }

    registerListeners(fc);
  };

  useEffect(() => {
    init();
  }, []);
  useEffect(() => () => flow && handleStop(), [flow]);
  useEffect(
    () => () => {
      flowConnect?.detach();
      flowConnect?.offAll();
    },
    [flowConnect]
  );

  return (
    <>
      <input
        accept="audio/*"
        onChange={(e) => {
          handleSourceSelect(e.target.files[0]);
        }}
        ref={uploaderEl}
        type="file"
        style={{ display: "none" }}
      />
      {ctxMenu && (
        <ContextMenu
          options={["Properties", "Delete"]}
          onSelect={handleCtxSelect}
          position={ctxMenu}
          onDismiss={() => {
            currContext.current = null;
            setCtxMenu(null);
          }}
          title={currContext.current.name}
        />
      )}
      {confirmDelete && (
        <Modal
          title="Are you sure ?"
          onDismiss={() => setConfirmDelete(false)}
          controls={["Yes", "Cancel"]}
          onAction={(action) => action === "Yes" && handleDelete()}
        >
          <span>
            Delete flow <em>{preview.name}</em> ?
          </span>
        </Modal>
      )}
      {srcNode && (
        <Modal
          className="minw-75 minh-75 maxh-75"
          title="Select Source File"
          titleExtras={
            <Button onClick={() => uploaderEl.current?.click()} icon="import" rect size={0.9}>
              Upload
            </Button>
          }
          onDismiss={() => setSrcNode(null)}
          controls={[]}
          onAction={(action) => handleTourAction(action)}
          layer={2}
          ref={(e) => (srcSelectorModal.current = e)}
        >
          <SourceSelector onSelect={(file) => handleSourceSelect(file)} />
        </Modal>
      )}
      <Header
        className="pointer-events-none"
        left={<Brand size={1} fixed editor />}
        center={<FlowName value={preview.name} onUpdate={handleNameUpdate} />}
        right={
          <div data-tour="6" className={styles["flow-controls"]}>
            <Button
              busy={saving}
              disabled={saving || state === "loading" || id === "temp"}
              onClick={handleSave}
              icon="save"
              iconLeft
              size={1}
              rect
            >
              Save
            </Button>
            <Button
              disabled={state === "loading"}
              onClick={handleDownload}
              icon="export"
              size={1}
              className="px-0p75 py-0p5"
              rect
            />
            <Button
              disabled={state === "loading" || id === "temp"}
              onClick={() => setConfirmDelete(true)}
              icon="delete"
              size={1}
              className="px-0p75 py-0p5"
              rect
            />
          </div>
        }
        transparent
        fixed
      />
      <main className={styles.main}>
        {loadMsg && (
          <div className={styles.spinner}>
            <Spinner size={2}>{loadMsg}</Spinner>
          </div>
        )}
        <EditorControls
          state={state}
          onPlay={handlePlay}
          onStop={handleStop}
          onReplay={handleReplay}
        />
        <Library onSelect={handleSelect} onDrop={handleDrop} />
        <Properties node={showProps} slide={!!showProps} onDismiss={() => setShowProps(null)} />
        <canvas ref={mainEl}></canvas>
      </main>
    </>
  );
};

export default Editor;

const setDefaultStyles = (fc) => {
  fc.setDefaultStyle("ui", "core/container", {
    backgroundColor: "#111111",
    shadowColor: "#222222",
    shadowBlur: 5,
    shadowOffset: Vector.create(5, 5),
  });
  fc.setDefaultStyle("ui", "core/v-slider", {
    color: "#fff",
    thumbColor: "grey",
  });
  fc.setDefaultStyle("ui", "core/toggle", {
    color: "#fff",
    backgroundColor: "grey",
  });
  fc.setDefaultStyle("ui", "core/source", {
    borderColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/slider", {
    color: "#fff",
    thumbColor: "grey",
  });
  fc.setDefaultStyle("ui", "core/2d-slider", {
    backgroundColor: "#999",
    thumbColor: "#fff",
    borderColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/select", {
    arrowColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/radio-group", {
    color: "#fff",
    backgroundColor: "transparent",
    selectedColor: "#fff",
    selectedBackgroundColor: "#555",
    borderColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/label", {
    color: "#fff",
    backgroundColor: "transparent",
  });
  fc.setDefaultStyle("ui", "core/input", {
    color: "#fff",
    backgroundColor: "#000",
    border: "#fff",
  });
  fc.setDefaultStyle("ui", "core/envelope", {
    borderColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/display", {
    borderColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/dial", {
    borderColor: "#fff",
  });
  fc.setDefaultStyle("ui", "core/button", {
    backgroundColor: "#fff",
    color: "#000",
  });
  fc.setDefaultStyle("node", {
    color: "#fff",
    titleColor: "#fff",
    maximizeButtonColor: "darkgrey",
    expandButtonColor: "#fff",
    minimizedTerminalColor: "green",
    outlineColor: "#fff",
  });
  fc.setDefaultStyle("connector", {
    width: 2,
    color: "#fff",
    border: true,
    borderColor: "grey",
  });
};
