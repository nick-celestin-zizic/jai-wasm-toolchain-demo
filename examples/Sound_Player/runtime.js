


/*

     Module Preload platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/Preload.js
     
*/

// These are all the functions that we declared as "#foreign" in our Jai code.
// They let you interact with the JS and DOM world from within Jai.
// If you forget to implement one, the Proxy below will log a nice error.
const exported_js_functions = {
    memcmp: (a, b, count) => {
        const [na, nb, nc] = [Number(a), Number(b), Number(count)];
        const u8    = new Uint8Array(allocated.buffer);
        const buf_a = u8.subarray(na, na + nc);
        const buf_b = u8.subarray(nb, nb + nc);
        for (let i = 0; i < count; i++) {
            const delta = Number(buf_a[i]) - Number(buf_b[i]);
            if (delta !== 0) return delta;
        }
        return 0;
    },
    
    wasm_write_string: (s_count, s_data, to_standard_error) => {
        const js_string = js_string_from_jai_string(s_data, s_count);
        write_to_console_log(js_string, to_standard_error);
    },
    
    wasm_debug_break: () => { debugger; },
    
    wasm_exit: (code) => {
        if (code === 0) {
            window.location.reload(); // should return to the "Click to Start" state and clean up memory
        } else {
            // Remove any existing canvases so that the user can see the error code message
            document.querySelectorAll("canvas").forEach(canvas => canvas.remove());
            window.addEventListener("click", (event) => window.location.reload());
            create_fullscreen_canvas("Program exited with error code "+code+".\nClick to Reload.");
        }
    },
    
    // freetype checks this for some settings of whatever, put some stuff here if you actually want to expose environment variables to wasm
    wasm_getenv: (_name) => { return 0n; },
};




const text_decoder = new TextDecoder();

const js_string_from_jai_string = (pointer, length) => {
    const u8 = new Uint8Array(allocated.buffer)
    const bytes = u8.subarray(Number(pointer), Number(pointer) + Number(length));
    return text_decoder.decode(bytes);
}

const js_string_from_jai_string_pointer = (string_pointer) => {
    const offset_count = Number(string_pointer);
    const offset_data  = offset_count + 8;
    const view = new DataView(allocated.buffer);
    return js_string_from_jai_string(
        view.getBigInt64(offset_data, true),
        view.getBigInt64(offset_count, true),
    );
}

const js_string_from_c_string = (pointer) => {
    let bytes = new Uint8Array(allocated.buffer)
    bytes = bytes.subarray(Number(pointer), bytes.length - Number(pointer));
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) {
            bytes = bytes.subarray(0, i);
            return text_decoder.decode(bytes);
        }
    }
    throw new Error("unreachable");
}




// console.log and console.error always add newlines so we need to buffer the output from write_string
// to simulate a more basic I/O behavior. We’ll flush it after a certain time so that you still
// see the last line if you forget to terminate it with a newline for some reason.
let console_buffer = "";
let console_buffer_is_standard_error;
let console_timeout;
const FLUSH_CONSOLE_AFTER_MS = 3;

const write_to_console_log = (str, to_standard_error) => {
    const flush_buffer = () => {
        if (!console_buffer) return;
    
        if (console_buffer_is_standard_error) {
            console.error(console_buffer);
        } else {
            console.log(console_buffer);
        }
    
        console_buffer = "";
    };
    
    if (console_buffer && console_buffer_is_standard_error != to_standard_error) {
        flush_buffer();
    }

    console_buffer_is_standard_error = to_standard_error;
    const lines = str.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
        console_buffer += lines[i];
        flush_buffer();
    }

    console_buffer += lines[lines.length - 1];

    clearTimeout(console_timeout);
    if (console_buffer) {
        console_timeout = setTimeout(() => { flush_buffer(); }, FLUSH_CONSOLE_AFTER_MS);
    }
}




// TODO: maybe all entrypoint funky stuff should be in runtime.jai?

let active_jmp_buf = 0n;

exported_js_functions.wasm_setjmp = (jmp_buf) => {
    const view = new DataView(allocated.buffer);
    const buf  = Number(jmp_buf);
    
    if (active_jmp_buf === 0n && jmp_buf !== yield_jmp_buf) { // I am a genius..... TODO: document why
        view.setBigInt64(buf + JMP_BUF_OFFSET_TOP, 0n, true);
        view.setBigInt64(buf + JMP_BUF_OFFSET_END, 0n, true);
        view.setBigInt64(buf + JMP_BUF_OFFSET_UNWOUND, 0n, true);
        view.setInt32(buf + JMP_BUF_OFFSET_STATE, 0, true);
        view.setInt32(buf + JMP_BUF_OFFSET_VALUE, 0, true);
    }
    
    if (active_jmp_buf !== 0n && active_jmp_buf !== jmp_buf) throw new Error(`unreachable? ${active_jmp_buf} ${jmp_buf}`);
    
    const state = view.getInt32(buf + JMP_BUF_OFFSET_STATE, true);
    if (state === JMP_BUF_STATE_INITIALIZED) {
        view.setInt32(buf + JMP_BUF_OFFSET_VALUE, 0, true);
        view.setInt32(buf + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_CAPTURING, true);
        
        active_jmp_buf = jmp_buf;
        jmp_buf_init(jmp_buf, view);
        start_unwind(jmp_buf);
        
        // This won't ever return if called from wasm, but will return if called from js
        return 0; 
    } else if (state === JMP_BUF_STATE_CAPTURING) {
        if (active_jmp_buf !== jmp_buf) throw new Error(`unreachable? ${active_jmp_buf} ${jmp_buf}`);
        view.setInt32(buf + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_CAPTURED, true);
        active_jmp_buf = 0n;
        stop_rewind();
        return 0;
    } else if (state === JMP_BUF_STATE_RETURNING) {
        stop_rewind();
        view.setInt32(buf + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_CAPTURED, true);
        active_jmp_buf = 0n;
        return view.getInt32(buf + JMP_BUF_OFFSET_VALUE, true);
    } else {
        throw new Error(`unreachable jmp_buf state ${state}`);
    }
};

exported_js_functions.wasm_longjmp = (jmp_buf, value) => {
    if (active_jmp_buf !== 0n) throw new Error(`Unreachable? ${active_jmp_buf} ${jmp_buf}`);
    if (value === 0) throw new Error("Dude do not pass 0 to longjmp what is wrong with you?");
    
    const view = new DataView(allocated.buffer);
    const buf  = Number(jmp_buf);
    view.setInt32(buf + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_RETURNING, true);
    view.setInt32(buf + JMP_BUF_OFFSET_VALUE, value, true);
    
    // here we unwind the stack into a dummy buffer since entry_point will rewind it back to jmp_buf
    jmp_buf_init(scratch_jmp_buf, view);
    start_unwind(scratch_jmp_buf);
    active_jmp_buf = jmp_buf;
};

const wasm_pause = () => {
    const value = exported_js_functions.wasm_setjmp(yield_jmp_buf);
    const view  = new DataView(allocated.buffer);
    const buf   = Number(yield_jmp_buf);
    const state = view.getInt32(buf + JMP_BUF_OFFSET_STATE, true);
    switch (state) {
    case JMP_BUF_STATE_CAPTURING : view.setInt32(buf + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_PAUSING,     true); break;
    case JMP_BUF_STATE_CAPTURED  : view.setInt32(buf + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_INITIALIZED, true); break;
    }
    return value;
};

const wasm_resume = (value) => {
    exported_js_functions.wasm_longjmp(yield_jmp_buf, value);
    active_jmp_buf = 0n;
    start_rewind(yield_jmp_buf);
    entry_point();
};

const entry_point = () => {
    while (true) {
        jai_main(jai_context);
        
        // The exit from main was the application actually exitting
        if (active_jmp_buf === 0n) {
            exported_js_functions.wasm_exit(0);
            return;
        }
        
        // The exit from main happened because the we are either doing setjmp/longjmp stuff or we are pausing execution.
        stop_unwind();
        
        const view  = new DataView(allocated.buffer);
        const buf   = Number(active_jmp_buf);
        const state = view.getInt32(buf + JMP_BUF_OFFSET_STATE, true);
        const value = view.getInt32(buf + JMP_BUF_OFFSET_VALUE, true);
        
        switch (state) {
        case JMP_BUF_STATE_PAUSING: {
            active_jmp_buf = 0n;
        } return; // do not rewind and re-enter main
        
        case JMP_BUF_STATE_CAPTURING: {
            view.setBigInt64(
                buf + JMP_BUF_OFFSET_UNWOUND,
                view.getBigInt64(buf + JMP_BUF_OFFSET_TOP, true),
                true
            );
        } break;
        
        case JMP_BUF_STATE_CAPTURED:
        case JMP_BUF_STATE_RETURNING: {
            view.setBigInt64(
                buf + JMP_BUF_OFFSET_TOP,
                view.getBigInt64(buf + JMP_BUF_OFFSET_UNWOUND, true),
                true
            );
        } break;
        
        default: {
            jmp_buf_log_header(active_jmp_buf);
            throw Error(`unreachable jmp_buf state ${state}`);
        }
        }
        
        start_rewind(active_jmp_buf);
    }
};

/*

ASYNC_BUF_SIZE :: 4096;

jmp_buf_header :: struct {
    top: *void;
    end: *void;
    unwound: *void;
    state: s32;
    value: s32;
};

jmp_buf :: struct {
    using header: jmp_buf_header;
    buffer: [ASYNC_BUF_SIZE - sizeof(jmp_buf_header)]u8;
};

*/

const JMP_BUF_SIZE = 4096;

const JMP_BUF_STATE_INITIALIZED = 0;
const JMP_BUF_STATE_CAPTURING   = 1;
const JMP_BUF_STATE_CAPTURED    = 2;
const JMP_BUF_STATE_RETURNING   = 3;
const JMP_BUF_STATE_PAUSING    = 4;

const JMP_BUF_OFFSET_TOP     = 0;
const JMP_BUF_OFFSET_END     = 8;
const JMP_BUF_OFFSET_UNWOUND = 16;
const JMP_BUF_OFFSET_STATE   = 24;
const JMP_BUF_OFFSET_VALUE   = 28;
const JMP_BUF_OFFSET_PAYLOAD = 32;

const jmp_buf_log_header = (_jmp_buf) => {
    const jmp_buf = Number(_jmp_buf);
    const view = new DataView(allocated.buffer);
    console.log(`jmp_buf: 0x${jmp_buf.toString(16)}
    top: 0x${view.getBigInt64(jmp_buf + JMP_BUF_OFFSET_TOP, true).toString(16)}
    end: 0x${view.getBigInt64(jmp_buf + JMP_BUF_OFFSET_END, true).toString(16)}
    unwound: 0x${view.getBigInt64(jmp_buf + JMP_BUF_OFFSET_UNWOUND, true).toString(16)}
    state: ${view.getInt32(jmp_buf + JMP_BUF_OFFSET_STATE, true)}
    value: ${view.getInt32(jmp_buf + JMP_BUF_OFFSET_VALUE, true)}
    `);
};

const jmp_buf_init = (jmp_buf, view) => {
    const buf = Number(jmp_buf);
    view.setBigInt64(buf + JMP_BUF_OFFSET_TOP, BigInt(buf + JMP_BUF_OFFSET_PAYLOAD), true);
    view.setBigInt64(buf + JMP_BUF_OFFSET_END, BigInt(buf + JMP_BUF_SIZE), true);
    view.setBigInt64(buf + JMP_BUF_OFFSET_UNWOUND, 0n, true);
};



/*

     Module Window_Creation platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/Window_Creation.js
     
*/

const canvases = [];
const get_canvas = (window) => {
    const canvas = canvases[window];
    if (!canvas) throw `Window id ${window} is not valid`;
    return canvas;
}

exported_js_functions.wasm_create_window = (width, height, name_ptr, window_x, window_y, parent, bg_color_ptr, wanted_msaa) => {
    const name = js_string_from_jai_string_pointer(name_ptr);
    const view = new DataView(allocated.buffer);
    
    const offset  = Number(bg_color_ptr);
    const color_r = view.getFloat32(offset + 0, true);
    const color_g = view.getFloat32(offset + 4, true);
    const color_b = view.getFloat32(offset + 8, true);
    
    
    const canvas  = document.createElement('canvas');
    canvas.id     = name;
    canvas.width  = Math.floor(0.5 + Number(width));
    canvas.height = Math.floor(0.5 + Number(height));
    canvas.style.backgroundColor = `rgba(${color_r * 255}, ${color_g * 255}, ${color_b * 255}, 1)`;
    canvas.style.position = "absolute";
    canvas.style.margin   = "0";
    canvas.style.left     = `${(window_x === -1n) ? 0 : window_x}px`;
    canvas.style.top      = `${(window_y === -1n) ? 0 : window_y}px`;
    
    if (parent !== -1n) throw new Error("TODO: What does that even mean in this context?");
    
    document.body.appendChild(canvas);
    canvases.push(canvas);
    const window_id = BigInt(canvases.length - 1);
    
    // This might be too much voodoo, or maybe just a good idea:
    
    // A lot of the example programs hard code the resolution to be bigger than your typical browser window can display at once.
    // This should be allowed since it is the equivalent of creating a window that is larger than your screen resolution, which is 
    // a valid thing to do in every operating system (why someone would do this is another question entirely...).
    // At the same time, there is a convention in the Window_Creation API that -1 for window position means to place it wherever.
    
    // We will extend that concept to mean that if you do not specify an initial window position, the created canvas will be mapped
    // to the entire browser window and we will forward window resizes to the Input module.
    
    // This is the best compromise I could think of that makes most programs behave how you would expect, with the one caveat
    // that you MUST explicitly position every window if your application has multiple windows.
    
    // An alterantive solution would be to implement a proper window manager in HTML/CSS/JS so that the user can resize the canvas like
    // they can in other OSes, which would be pretty cool thing to try and implement
    
    // The one edge case I can think of here is a situation where you are using Simp but not Input, and in that case you can call
    // Simp.get_render_dimensions explicitly anyway
    
    // -nzizic, 2 May 2025
    
    if (window_x === -1n && window_y === -1n) {
        canvas.style.width  = "100%";
        canvas.style.height = "100%";
        if (fullscreen_canvas_resize_listener !== undefined) {
            const listen = fullscreen_canvas_resize_listener(window_id);
            window.addEventListener("resize", listen);
            listen();
        } else {
            const scale   = Math.ceil(window.devicePixelRatio);
            canvas.width  = window.innerWidth  * scale;
            canvas.height = window.innerHeight * scale;
            // canvas.style.width  = `${window.innerWidth}px`;
            // canvas.style.height = `${window.innerHeight}px`;
        }
    }
    
    return window_id;
};

exported_js_functions.wasm_get_mouse_pointer_position = (window_id, right_handed, out_x, out_y) => {
    const canvas = get_canvas(window_id);
    const rect = canvas.getBoundingClientRect();
    
    const scale = Math.ceil(window.devicePixelRatio);
    const x = BigInt(Math.floor(scale * (0.5 + mouse_position_x - rect.left)));
    const y = (right_handed !== 0)
        ? BigInt(Math.floor(scale * (0.5 + rect.bottom - (window.innerHeight * (mouse_position_y / window.innerHeight)))))
        : BigInt(Math.floor(scale * (0.5 + mouse_position_y - rect.top)));
    
    const view  = new DataView(allocated.buffer);
    view.setBigInt64(Number(out_x), x, true);
    view.setBigInt64(Number(out_y), y, true);
};

exported_js_functions.wasm_get_render_dimensions = (window, width_ptr, height_ptr) => {
    const canvas = get_canvas(window);
    const view   = new DataView(allocated.buffer);
    view.setInt32(Number(width_ptr),  canvas.width, true); // Write width
    view.setInt32(Number(height_ptr), canvas.height, true); // Write height
};

exported_js_functions.wasm_get_dimensions = (window, right_handed, x_ptr, y_ptr, width_ptr, height_ptr) => {
    // if (right_handed !== 0) throw "TODO wasm_get_dimensions right_handed";
    
    const canvas = get_canvas(window);
    const view   = new DataView(allocated.buffer);
    
    // TODO: css absolute position stuff??
    view.setInt32(Number(x_ptr), 0, true);
    view.setInt32(Number(y_ptr), 0, true);
    view.setInt32(Number(width_ptr),  canvas.width, true); // Write width
    view.setInt32(Number(height_ptr), canvas.height, true); // Write height
};



/*

     Module Input platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/Input.js
     
*/

// One important thing to note about working with event listeners with this webassembly stuff:
// DO NOT CALL exported_wasm_functions from eventListeners! If an even listener is firing that means
// that the wasm execution is suspended and calling procedures does NOTHING. I'm sure there is a way to
// have a runtime check for this with another proxy object and checking the state of the yield_jmp_buf
// so that a nice error could be thrown, but I really do not want to do that so just be careful ok!
// -nzizic, 2 May 2025



// keyboard

let key_inputs = [];

const jai_keycode_from_js_event = (event) => {
    switch (event.key) {
    case "ArrowUp":    return 128;
    case "ArrowDown":  return 129;
    case "ArrowLeft":  return 130;
    case "ArrowRight": return 131;
    
    case "Alt":     return 139;
    case "Control": return 140;
    case "Shift":   return 141;
    }
    
    if (event.key.length ==  1) return event.key.codePointAt(0);
    if (event.keyCode    <= 32) return event.keyCode;
    
    console.warn("[jai_keycode_from_js_event] unhandled event ", event);
};

document.addEventListener("keydown", (event) => {
    key_inputs.push({
        code: jai_keycode_from_js_event(event),
        down: true,
    });
});

document.addEventListener("keyup", (event) => {
    key_inputs.push({
        code: jai_keycode_from_js_event(event),
        down: false,
    });
});



// mouse

let mouse_position_x = 0;
let mouse_position_y = 0;
document.addEventListener("mousemove", (event) => {
    const scale = Math.ceil(window.devicePixelRatio);
    mouse_position_x = event.clientX;
    mouse_position_y = event.clientY;
});

document.addEventListener("pointerdown", (event) => {
    let code;
    if (event.button === 0) code = 168;
    else if (event.button === 1) code = 169;
    else if (event.button === 2) code = 170;
    else throw `TODO: mouse button ${event.button} is not suppported!`;
    key_inputs.push({
        code: code,
        down: true,
    });
});

document.addEventListener("pointerup", (event) => {
    let code;
    if (event.button === 0) code = 168;
    else if (event.button === 1) code = 169;
    else if (event.button === 2) code = 170;
    else throw `TODO: mouse button ${event.button} is not suppported!`;
    key_inputs.push({
        code: code,
        down: false,
    });
});

// window resize
const window_resizes = [];
const fullscreen_canvas_resize_listener = (window_id) => () => {
    const canvas  = get_canvas(window_id);
    const scale   = Math.ceil(window.devicePixelRatio);
    canvas.width  = window.innerWidth  * scale;
    canvas.height = window.innerHeight * scale;
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    // canvas.getContext("2d").setTransform(scale, 0, 0, scale, 0, 0);
    // console.log("pixel ratio is ", scale);
    window_resizes.push({
        id: window_id,
        w: canvas.width,
        h: canvas.height,
    });
};

// touch
const last_touches = [];
const touches = [];
exported_js_functions.wasm_device_supports_touch_input = () => { return 'ontouchstart' in document.documentElement; };
document.addEventListener("touchstart", (event) => {
    if (allocated !== undefined) event.preventDefault();
    
    last_touches.length = 0;
    last_touches.push(...event.targetTouches);
    const scale = Math.ceil(window.devicePixelRatio);
    for (let it_index = 0; it_index < event.targetTouches.length; it_index++) {
        const it = event.targetTouches[it_index];
        touches.push({
            id: it.identifier,
            touch_type: 1,
            x: it.pageX * scale,
            y: it.pageY * scale,
        });
    }
}, { passive: false });
document.addEventListener("touchmove", (event) => {
    if (allocated !== undefined) event.preventDefault();
    last_touches.length = 0;
    last_touches.push(...event.targetTouches);
    const scale = Math.ceil(window.devicePixelRatio);
    for (let it_index = 0; it_index < event.targetTouches.length; it_index++) {
        const it = event.targetTouches[it_index];
        touches.push({
            id: it.identifier,
            touch_type: 0,
            x: it.pageX * scale,
            y: it.pageY * scale,
        });
    }
}, { passive: false });
document.addEventListener("touchend", (event) => {
    if (allocated !== undefined) event.preventDefault();
    const scale = Math.ceil(window.devicePixelRatio);
    
    const stupid = new Set(event.targetTouches);
    console.log(stupid);
    
    for (let last_touch_index = 0; last_touch_index < last_touches.length; last_touch_index++) {
        const last_touch = last_touches[last_touch_index];
        if (!stupid.has(last_touch.identifier)) touches.push({
            id: last_touch.identifier,
            touch_type: 2,
            x: last_touch.pageX * scale,
            y: last_touch.pageY * scale,
        });
    }
    last_touches.length = 0;
}, { passive: false });
document.addEventListener("touchcancel", (event) => {
    if (allocated !== undefined) event.preventDefault();
    const scale = Math.ceil(window.devicePixelRatio);
    
    const stupid = new Set(event.targetTouches);
    console.log(stupid);
    
    for (let last_touch_index = 0; last_touch_index < last_touches.length; last_touch_index++) {
        const last_touch = last_touches[last_touch_index];
        if (!stupid.has(last_touch.identifier)) touches.push({
            id: last_touch.identifier,
            touch_type: 2,
            x: last_touch.pageX * scale,
            y: last_touch.pageY * scale,
        });
    }
    last_touches.length = 0;
}, { passive: false });


// update 
let mouse_position_x_last_frame = 0;
let mouse_position_y_last_frame = 0;
exported_js_functions.wasm_update_window_events = () => {
    exported_wasm_functions.reset_events_this_frame(jai_context);
    
    const mouse_delta_x = mouse_position_x - mouse_position_x_last_frame;
    const mouse_delta_y = mouse_position_y - mouse_position_y_last_frame;
    mouse_position_x_last_frame = mouse_position_x;
    mouse_position_y_last_frame = mouse_position_y;
    
    exported_wasm_functions.set_mouse_delta(mouse_delta_x, mouse_delta_y, 0);
    for (let i = 0; i < key_inputs.length; i++) {
        const it = key_inputs[i];
        if (it.down && it.code >= 32 && it.code < 127) exported_wasm_functions.add_text_input_event(jai_context, it.code);
        exported_wasm_functions.add_key_event(jai_context, it.code, it.down);
    }
    key_inputs.length = 0;
    
    for (let i = 0; i < window_resizes.length; i++) {
        const it = window_resizes[i];
        exported_wasm_functions.add_window_resize(jai_context, it.id, it.w, it.h);
    }
    window_resizes.length = 0;
    
    for (let i = 0; i < touches.length; i++) {
        const it = touches[i];
        exported_wasm_functions.add_touch(jai_context, it.id, it.touch_type, it.x, it.y);
    }
    touches.length = 0;
};


/*

     Module Basic platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/Basic.js
     
*/

const time_origin = Date.now();
exported_js_functions.wasm_get_microseconds = () => { return BigInt((Number(time_origin) + Number(performance.now())) * 1000); };
exported_js_functions.wasm_sleep_milliseconds = (ms) => { if (wasm_pause() === 0) setTimeout(() => { wasm_resume(1); }, ms); };



/*

     Module WebAudio platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/WebAudio.js
     
*/

const sounds  = {}; // JS.string -> JS.URL
const streams = {}; // Jai.*Sound_Stream -> JS.Audio

exported_js_functions.webaudio_load_audio_file = (path_pointer, optional, out_sound_data) => {
    // if (setjmp_and_suspend(yield_jmp_buf) === 0) (async () => {
    if (wasm_pause() === 0) (async () => {
        const path     = js_string_from_jai_string_pointer(path_pointer);
        const response = await fetch(path);
        const data     = await response.blob();
        sounds[path]   = URL.createObjectURL(data);
        wasm_resume(1);
        // longjmp(yield_jmp_buf, 1);
    })(); else {
        const view     = new DataView(allocated.buffer);
        const count    = view.getBigInt64(Number(path_pointer) + 0, true); // path_pointer.count
        const old_data = view.getBigInt64(Number(path_pointer) + 8, true); // path_pointer.data
        const new_data = jai_alloc(jai_context, count);
        
        const dst = new Uint8Array(allocated.buffer, Number(new_data), Number(count));
        const src = new Uint8Array(allocated.buffer, Number(old_data), Number(count));
        dst.set(src); // copy the string over
        
        const base = Number(out_sound_data);
        view.setBigInt64(base + 0, count, true);    // result.path.count = path_pointer.count
        view.setBigInt64(base + 8, new_data, true); // result.path.data  = new_data;
        view.setInt8(base + 16, 1, true);           // result.loaded = true;
    }
};

exported_js_functions.webaudio_get_devices = (devices) => {
    console.log("TODO: webaudio_get_devices");
}

// we have to save to an intermediate array becuase the wasm module
// is suspended while event listeners are firing, so we cannot just call jai_free
streams_to_free = [];
const non_repeating_sound_stream_listener = (stream) => () => {
    streams_to_free.push(stream);
    delete streams[stream];
}

exported_js_functions.webaudio_update = (dt) => {
    for (let i = 0; i < streams_to_free.length; i++) {
        const it = streams_to_free[i];
        jai_free(jai_context, it);
    }
    streams_to_free.length = 0;  
};

exported_js_functions.webaudio_make_audio = (stream, _name) => {
    const name  = js_string_from_jai_string_pointer(_name);
    const sound = sounds[name];
    if (name === undefined) throw new Error(`Sound ${name} does not exist!`);
    
    const audio = new Audio();
    audio.src = sound;
    streams[stream] = audio;
    audio.addEventListener("ended", non_repeating_sound_stream_listener(stream));
};

exported_js_functions.webaudio_sound_player_init = (config) => {
    console.log("webaudio_sound_player_init");
    return 1;
};

exported_js_functions.webaudio_sound_player_shutdown = () => {
    for (const [sound_stream, audio] of Object.entries(streams)) {
        audio.pause();
        jai_free(jai_context, sound_stream);
        delete streams[sound_stream];
    }
};

exported_js_functions.webaudio_start_playing = (stream) => {
    const audio = streams[stream];
    if (audio === undefined) throw new Error(`Stream at address 0x${stream.toString(16)} was not created with make_stream()!`);
    audio.play();
};

exported_js_functions.webaudio_set_repeating = (stream, repeating) => {
    const audio = streams[stream];
    if (audio === undefined) throw new Error(`Sound_Stream at address 0x${stream.toString(16)} was not created by WebAudio!`);
    
    if (repeating === 0) {
        audio.addEventListener("ended", non_repeating_sound_stream_listener(stream));
        audio.loop = false;
    } else if (repeating === 1) {
        audio.removeEventListener("ended", non_repeating_sound_stream_listener(stream));
        audio.loop = true;
    } else {
        throw new Error("[webaudio_set_repeating] unreachable");
    }
};


/*

     Module Runtime_Support platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/Runtime_Support.js
     
*/

let exported_wasm_functions;
let allocated; // A global reference of the WASM’s memory area so that we can look up pointersj
let jai_context;

let jai_main;
let jai_alloc;
let jai_free;

// TODO: we could probably combine these if you really think about it. Since we only use the scratch buffer when jumping
// and only use the yield buffer when pausing. These two things cannot be happenning at the same time, right? Yeah I am pretty sure we can
let yield_jmp_buf;
let scratch_jmp_buf;

let start_unwind;
let stop_unwind;
let start_rewind;
let stop_rewind;

// Create the environment for the WASM file,
// which includes the exported JS functions for the WASM:
const imports = {
    "env": new Proxy(exported_js_functions, {
        get(target, prop, receiver) {
            if (target.hasOwnProperty(prop)) return target[prop];
            return () => { throw new Error("Missing function: " + prop); };
        },
    }),
    "memory": new WebAssembly.Memory({'initial': 256,'maximum': 65536}),
    // __memory_base: 256, // from https://www.tutorialspoint.com/webassembly/webassembly_dynamic_linking.htm idk why
}

const load_wasm = () => WebAssembly.instantiateStreaming(fetch("main.wasm"), imports).then(
    (obj) => {
        console.log(obj);
        wasm = obj;
        
        // setup the runtime
        exported_wasm_functions = obj.instance.exports;
        allocated     = exported_wasm_functions.memory;
        jai_context   = exported_wasm_functions.__jai_runtime_init(0, 0n);
        
        const view = new DataView(allocated.buffer);
        
        yield_jmp_buf = exported_wasm_functions.get_yield_jmp_buf();
        jmp_buf_init(yield_jmp_buf, view);
        
        scratch_jmp_buf = exported_wasm_functions.get_scratch_jmp_buf();
        jmp_buf_init(scratch_jmp_buf, view);
        
        // export any jai code that we might need to call from the js runtme
        const find_proc = (name) => {
            const re = new RegExp('^'+name+'_[0-9a-z]+$');
            for (let full_name in exported_wasm_functions) if (re.test(full_name)) {
                return exported_wasm_functions[full_name];
            }
            throw `Could not find ${name} in the wasm module!`;
        }
        
        jai_main  = exported_wasm_functions.__program_main;
        jai_alloc = exported_wasm_functions.jai_alloc;
        jai_free  = find_proc("free");
        
        start_unwind = exported_wasm_functions.asyncify_start_unwind;
        stop_unwind  = exported_wasm_functions.asyncify_stop_unwind;
        start_rewind = exported_wasm_functions.asyncify_start_rewind;
        stop_rewind  = exported_wasm_functions.asyncify_stop_rewind;
        
        entry_point();
    }
);


const fullscreen_canvas_id = "fullscreen_canvas";
const start_wasm_listner = (event) => {
    console.log("Starting the wasm application! ", event);
    window.removeEventListener("click", start_wasm_listner);
    document.getElementById(fullscreen_canvas_id).remove();
    load_wasm();
};

const create_fullscreen_canvas = (text) => {
    const canvas  = document.createElement("canvas");
    canvas.id     = fullscreen_canvas_id;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position  = "absolute";
    canvas.style.left      = "50%";
    canvas.style.top       = "50%";
    canvas.style.transform = "translate(-50%, -50%)";
    document.body.appendChild(canvas);
    
    const ctx = canvas.getContext("2d");
    ctx.fillStyle    = "white";
    ctx.font         = "60px Georgia";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    
    const lines = text.split("\n");
    const line_height  = 70;
    const total_height = lines.length * line_height;
    lines.forEach((line, index) => {
        const y = (canvas.height / 2) - (total_height / 2) + (index * line_height);
        ctx.fillText(line, canvas.width / 2, y);
    });
};


// in order to play any sound, the user needs to interact with the window, so we have to install this event listener
window.addEventListener("click", start_wasm_listner);
create_fullscreen_canvas("Click to Start.");




/*

     Module File platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/File.js
     
*/

// when you call file_open, we call fetch but do not wait for it to complete, read_entire_file then blocks until all of the data is ready
const files = [];
const file_open = (promise) => {
    for (let i = 0; i < files.length; i++) {
        if (files[i] === undefined) {
            files[i] = promise;
            return i;
        }
    }
    files.push(promise);
    return files.length - 1;
};
const file_close = (index) => { files[index] = undefined; };

exported_js_functions.wasm_file_open = (_name, for_writing, keep_existing_content, log_errors, out_file, out_success) => {
    const name = js_string_from_jai_string_pointer(_name); 
    // console.log(`file_open(${[name, for_writing, keep_existing_content, log_errors]}) -> (${[out_file, out_success]})`);
    if (for_writing !== 0) throw "TODO: don't fetch if we are not reading?";
    
    const index = file_open(fetch(name).then((resp) => resp.arrayBuffer()));
    const view  = new DataView(allocated.buffer);
    view.setInt32(Number(out_file), index, true);
    view.setInt32(Number(out_success), 1, true);
};

exported_js_functions.wasm_file_close = (file) => {
    // console.log(`file_close(${file})`);
};

// TODO: don't start the read in file_open and just report an error on file_write
exported_js_functions.wasm_read_entire_file = (file, zero_terminated, out_content, out_success) => {
    if (wasm_pause() === 0) {
        // TODO: .catch(...) with wasm_resume(2) to propogate the error properly
        files[file].then((buffer) => {
            files[file] = new Uint8Array(buffer);
            wasm_resume(1);
        });
    } else {
        const src = files[file];
        const mem = jai_alloc(jai_context, BigInt(src.length + ((zero_terminated !== 0) ? 1 : 0)));
        const dst = new Uint8Array(allocated.buffer, Number(mem), src.length);
        dst.set(src);
        if (zero_terminated) dst[dst.byteLength] = 0;
        
        const view = new DataView(allocated.buffer);
        view.setBigInt64(Number(out_content) + 0, BigInt(src.length), true);
        view.setBigInt64(Number(out_content) + 8, mem, true);
        view.setInt32(Number(out_success), 1, true);
    }
};



/*

     Module WebGL platform layer inserted from D:/Dev/wasm_toolchain/modules/Toolchains/Wasm/libjs/WebGL.js
     
*/

let front_canvas = undefined;
const back_canvas = new OffscreenCanvas(0, 0);
const gl = back_canvas.getContext("webgl2");
if (!gl ||
    !gl.getExtension("EXT_texture_filter_anisotropic")
) throw new Error("Browser does not support WebGL!");

const gl_handles = []; // this stores both shader components and programs
const gl_obj2id = (obj) => {
    gl_handles.push(obj);
    return gl_handles.length;
};
const gl_id2obj = (handle) => {
    // since gl procedures use an ID of 0 as a sentinel that webgl uses null for
    if (handle === 0) return null;
    const index = handle - 1;
    const obj   = gl_handles[index];
    if (!obj) throw new Error(`Handle ${handle} does not refer to a valid opengl object`);
    return obj;
};


exported_js_functions.wasm_gl_set_render_target = (window_id) => {
    front_canvas = get_canvas(window_id);
    back_canvas.width  = front_canvas.width;
    back_canvas.height = front_canvas.height;
};

// TODO: maybe don't requestAnimationFrame? or only do it when vsync=true?
exported_js_functions.wasm_webgl_swap_buffers = (window, vsync) => {
    if (wasm_pause() === 0) requestAnimationFrame(() => {
        exported_js_functions.wasm_gl_set_render_target(window);
        front_canvas.getContext("2d").drawImage(back_canvas, 0, 0, front_canvas.width, front_canvas.height);
        wasm_resume(1);
    });
};

exported_js_functions.glViewport = (x, y, width, height) => { gl.viewport(x, y, width, height); };
exported_js_functions.glScissor = (x, y, width, height) => { gl.scissor(x, y, width, height); };
exported_js_functions.glCreateProgram = () => { return gl_obj2id(gl.createProgram()); };
exported_js_functions.glCreateShader = (typ) => { return gl_obj2id(gl.createShader(typ)); };
exported_js_functions.glAttachShader = (program, shader) => { gl.attachShader(gl_id2obj(program), gl_id2obj(shader)); };
exported_js_functions.glLinkProgram = (program) => { gl.linkProgram(gl_id2obj(program)); };
exported_js_functions.glDeleteShader = (shader) => { gl.deleteShader(gl_id2obj(shader)); };
exported_js_functions.glBindTexture = (target, texture) => { gl.bindTexture(target, gl_id2obj(texture)); };
exported_js_functions.glClearColor = (r, g, b, a) => { gl.clearColor(r, g, b, a); };
exported_js_functions.glClear = (mask) => { gl.clear(mask); };
exported_js_functions.glDepthMask = (flag) => { gl.depthMask(flag); };
exported_js_functions.glDisable = (cap) => { gl.disable(cap); };
exported_js_functions.glUseProgram = (program) => { gl.useProgram(gl_id2obj(program)); };
exported_js_functions.glUniformBlockBinding = (program, index, binding) => { gl.uniformBlockBinding(gl_id2obj(program), index, binding); };
exported_js_functions.glUniform1i = (loc, v) => { gl.uniform1i(gl_id2obj(loc), v); };
exported_js_functions.glEnableVertexAttribArray = (index) => { gl.enableVertexAttribArray(index); };
exported_js_functions.glVertexAttribPointer = (index, size, typ, norm, stride, p) => { gl.vertexAttribPointer(index, size, typ, norm, stride, Number(p)); };
exported_js_functions.glVertexAttribIPointer = (index, size, typ, stride, offset) => { gl.vertexAttribIPointer(index, size, typ, stride, Number(offset)); };
exported_js_functions.glDrawArrays = (mode, first, count) => { gl.drawArrays(mode, first, count); };
exported_js_functions.glDrawElements = (mode, count, typ, offset) => { gl.drawElementsInstanced(mode, count, typ, Number(offset), 1); };
exported_js_functions.glTexParameteri = (target, pname, param) => { gl.texParameteri(target, pname, param); };
exported_js_functions.glTexParameterf = (target, pname, param) => { gl.texParameterf(target, pname, param); };
exported_js_functions.glPixelStorei = (pname, param) => { gl.pixelStorei(pname, param); };
exported_js_functions.glActiveTexture = (texture) => { gl.activeTexture(texture); };
exported_js_functions.glBlendFunc = (s,d) => { gl.blendFunc(s, d); };
exported_js_functions.glEnable = (cap) => { gl.enable(cap); };
exported_js_functions.glFlush = () => { gl.flush(); };
exported_js_functions.glCompileShader = (shader) => { gl.compileShader(gl_id2obj(shader)); };
exported_js_functions.glGetIntegerv   = (pname, data) => { new DataView(allocated.buffer).setInt32(Number(data), gl.getParameter(pname), true); };
exported_js_functions.glGetShaderiv   = (shader, pname, out_param) => { new DataView(allocated.buffer).setInt32(Number(out_param), gl.getShaderParameter(gl_id2obj(shader), pname), true); };
exported_js_functions.glGetProgramiv  = (shader, pname, out_param) => { new DataView(allocated.buffer).setInt32(Number(out_param), gl.getProgramParameter(gl_id2obj(shader), pname), true); };
exported_js_functions.glGetAttribLocation = (program, name) => { return gl.getAttribLocation(gl_id2obj(program), js_string_from_c_string(name)); };
exported_js_functions.glGetUniformLocation = (program, name) => { return gl_obj2id(gl.getUniformLocation(gl_id2obj(program), js_string_from_c_string(name))); };
exported_js_functions.glBindFramebuffer = (target, buffer) => { gl.bindFramebuffer(target, gl_id2obj(buffer)); };
exported_js_functions.glBindVertexArray = (array) => { gl.bindVertexArray(gl_id2obj(array)); };
exported_js_functions.glBindBuffer = (target, buffer) => { gl.bindBuffer(target, gl_id2obj(buffer)); };
exported_js_functions.glBindBufferBase = (target, index, buffer) => { gl.bindBufferBase(target, index, gl_id2obj(buffer)); };
exported_js_functions.glBufferData = (target, size, data, usage) => { gl.bufferData(target, (data === 0n) ? Number(size) : new DataView(allocated.buffer, Number(data), Number(size)), usage); };
exported_js_functions.glBufferSubData = (target, offset, size, _data) => { gl.bufferSubData(target, Number(offset), new DataView(allocated.buffer, Number(_data), Number(size))); };

exported_js_functions.glGenVertexArrays = (n, arrays) => {
    const view = new DataView(allocated.buffer);
    for (let i = 0; i < n; i++) {
        const handle = gl_obj2id(gl.createVertexArray());
        view.setUint32(Number(arrays) + i * 4, handle, true);
    }
};

exported_js_functions.glGenBuffers = (n, buffers) => {
    const view = new DataView(allocated.buffer);
    for (let i = 0; i < n; i++) {
        const handle = gl_obj2id(gl.createBuffer());
        view.setUint32(Number(buffers) + i * 4, handle, true);
    }
};

exported_js_functions.glGenTextures = (n, buffers) => {
    const view = new DataView(allocated.buffer);
    for (let i = 0; i < n; i++) {
        const handle = gl_obj2id(gl.createTexture());
        view.setUint32(Number(buffers) + i * 4, handle, true);
    }
};

exported_js_functions.glShaderSource = (_shader, count, strings_data, lengths_data) => {
    const shader = gl_id2obj(_shader);
    const view = new DataView(allocated.buffer);
    const sources = [];
    for (let i = 0; i < count; i++) {
        const count  = view.getInt32(Number(lengths_data) + i * 4, true);
        const data   = view.getBigInt64(Number(strings_data) + i * 8, true);
        const source = js_string_from_jai_string(data, count);
        sources.push(source);
    }
    gl.shaderSource(shader, sources.join("\n")); // Join the source strings with newlines
};


exported_js_functions.glGetShaderInfoLog = (_shader, length_ptr, data_ptr) => {
    gl = gl;
    const shader = gl_id2obj(_shader);
    const info = gl.getShaderInfoLog(shader);
    throw `TODO: copy jai_string_from_js_string from fugue \n\n${info}`;
};



exported_js_functions.glGetUniformBlockIndex = (_program, _name) => {
    const program = gl_id2obj(_program);
    const name = js_string_from_c_string(_name);
    const [ index ] = gl.getUniformIndices(program, [ name ]);
    return index;
};

exported_js_functions.glUniformMatrix4fv = (_location, count, transpose, value_ptr) => {
    if (count !== 1) throw "TODO: handle packed array of matrices";
    gl.uniformMatrix4fv(gl_id2obj(_location), transpose, new Float32Array(allocated.buffer, Number(value_ptr), 16));
};

exported_js_functions.glTexImage2D = (target, level, internalformat, width, height, border, format, typ, pixels) => {
    let components;
    let element_size;
    
    if (internalformat === gl.RGB8) {
        components = 3;
    } else if (internalformat === gl.RGBA8) {
        components = 4;
    } else throw `TODO: Unsupported texture internal format ${internalformat}`;
    
    if (typ === gl.UNSIGNED_BYTE) {
        element_size = 1;
    } else throw `TODO: Unsupported texture element type ${typ}`;
    
    const data = new Uint8Array(allocated.buffer, Number(pixels), width*height*components*element_size);
    gl.texImage2D(target, level, internalformat, width, height, border, format, typ, data);
};