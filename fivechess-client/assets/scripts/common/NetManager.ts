import ProtocolManager from "../tsProtocol/ProtocolManager";
import ByteBuffer from "../tsProtocol/buffer/ByteBuffer";

import {EventManager} from "./EventManager";
import {EventEnum} from "./EventEnum";
import {ResponseManager} from "./ResponseManager";

enum State {
    DISCONNECT = 1,  // 未连接
    CONNECTING = 2,  // 连接中
    CONNECTED = 3,   // 已连接
}

/**
 * 负责网络连接处理
 */
export class NetManager {
    private static state: State = State.DISCONNECT;
    private static socket: WebSocket = null;
    private static msgQueue = [];
    private static responseHandlerSet = new Set();

    /**
     * 连接服务器
     */
    public static connect(url: string) {
        if (this.state != State.DISCONNECT) {
            return;
        }

        // 网络处理
        NetManager.state = State.CONNECTING;
        NetManager.socket = new WebSocket(url);
        NetManager.socket.binaryType = 'arraybuffer';

        NetManager.socket.onopen = () => {
            console.log('connect to server success!!!');

            this.state = State.CONNECTED;
            EventManager.sendEvent(EventEnum.CONNECTED_EVENT, null);
        };

        NetManager.socket.onmessage = (event) => {
            const data = event.data;

            const byteBuffer = new ByteBuffer();
            byteBuffer.writeBytes(data);
            byteBuffer.setReadOffset(4);
            const packet = ProtocolManager.read(byteBuffer);
            byteBuffer.readBoolean();

            console.log('recv:', packet);
            this.msgQueue.push(packet);
        };

        NetManager.socket.onerror = () => {
        };

        NetManager.socket.onclose = () => {
            cc.error('disconnect to server!!!');

            if (this.state == State.CONNECTED && this.socket != null) {
                this.socket.close();
                this.socket = null;
            }

            this.state = State.DISCONNECT;
            EventManager.sendEvent(EventEnum.DISCONNECT_EVENT, null);
        };
    }

    /**
     * 发送消息
     */
    public static sendMessage(packet) {
        if (NetManager.state != State.CONNECTED) {
            cc.error("only can send msg on CONNECTED status!!!");
            return;
        }

        if (NetManager.socket == null) {
            cc.error("socket null, can not send msg");
            return;
        }

        const byteBuffer = new ByteBuffer();
        byteBuffer.setWriteOffset(4);
        ProtocolManager.write(byteBuffer, packet);
        byteBuffer.writeBoolean(false);

        const writeOffset = byteBuffer.writeOffset;
        byteBuffer.setWriteOffset(0);
        byteBuffer.writeRawInt(writeOffset - 4);
        byteBuffer.setWriteOffset(writeOffset);
        this.socket.send(byteBuffer.buffer);

        cc.log("send:", packet);
    }

    public static registerNetHandler(handler) {
        if (NetManager.responseHandlerSet.has(handler)) {
            return;
        }

        NetManager.responseHandlerSet.add(handler);
    }

    public static unregisterNetHandler(handler) {
        if (!NetManager.responseHandlerSet.has(handler)) {
            return;
        }

        NetManager.responseHandlerSet.delete(handler);
    }

    public static update() {
        if (NetManager.msgQueue.length == 0) {
            return;
        }

        let packet = NetManager.msgQueue.shift();

        // 先是全局消息进行处理同步好服务器数据
        ResponseManager.processResponse(packet.protocolId(), packet);

        // 处理各个handler
        NetManager.responseHandlerSet.forEach(handler => {
            // @ts-ignore
            handler.processResponse(packet.protocolId(), packet);
        });
    }
}
