// These are all the functions that we declared as "#foreign" in our Jai code.
// They let you interact with the JS and DOM world from within Jai.
// If you forget to implement one, the Proxy below will log a nice error.
const exported_js_functions = {
    // TODO: investigate why we need this memcmp
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
        const string = js_string_from_jai_string(s_data, s_count);
        write_to_console_log(string, to_standard_error);
    },
    wasm_debug_break: () => { debugger; },
    
    wasm_exit: (code) => {
        if (code === 0) {
            window.location.reload(); // should return to the "Click to Start" state and clean up memory
        } else {
            // Remove any existing canvases so that the user can see the error code message
            document.querySelectorAll("canvas").forEach(canvas => canvas.remove());
            create_fullscreen_canvas("Program Exited With Error "+code+"\nClick to Restart");
            // TODO: maybe log a stack trace to the console?
        }
    },
    
    
    
    _setjmp: (jmp_buf, file_ptr, line) => {
        const file = js_string_from_c_string(file_ptr);
        // console.log(`setjmp(0x${jmp_buf.toString(16)}) ${file}:${line}`);
        
        if (active_jmp_buf === 0n) { // I am a genius..... TODO: document why
            // console.log(`zero initializing 0x${jmp_buf.toString(16)}...`);
            const view = new DataView(allocated.buffer);
            const base = Number(jmp_buf);
            view.setBigInt64(base + JMP_BUF_OFFSET_TOP, 0n, true);
            view.setBigInt64(base + JMP_BUF_OFFSET_END, 0n, true);
            view.setBigInt64(base + JMP_BUF_OFFSET_UNWOUND, 0n, true);
            view.setInt32(base + JMP_BUF_OFFSET_STATE, 0, true);
            view.setInt32(base + JMP_BUF_OFFSET_VALUE, 0, true);
        }
        
        return setjmp(jmp_buf);
    },
    
    _longjmp: (jmp_buf, value, file_ptr, line) => {
        // const file = js_string_from_c_string(file_ptr);
        // console.log(`longjmp(${jmp_buf.toString(16)}, value) ${file}:${line}`);
        longjmp(jmp_buf, value, true);
    },
    
    // freetype checks this for some settings of whatever, put some stuff here if you actually want to expose environment variables to wasm
    getenv: (_name) => { return 0n; },
    
    // exp: Math.exp,(x) => {
    //     const ret = Math.exp(x);
    //     return ret;
    // },
    
    // log: (x) => {
    //     const ret = Math.log(x);
    //     return ret;
    // },
    
    // stubbing out thread stuff to see how far I can go with just ignoring it huehueh
    wasm_mutex_init: (mutex, desired_name, desired_order) => {
        console.log(`wasm_mutex_init(0x${mutex.toString(16)}, ${js_string_from_jai_string_pointer(desired_name)}, ${desired_order}))`);
    },
    
    wasm_csection_lock: (csection) => {
        console.log(`wasm_csection_lock(0x${csection.toString(16)})`);
    },
    
    wasm_sound_player_init: (config, backend) => {
        console.log(`wasm_sound_player_init(0x${config.toString(16)}, 0x${backend.toString(16)})`);
        new DataView(allocated.buffer).setInt32(Number(backend), 0xffffff, true);
    },
    
    wasm_thread_init: (thread, proc, temporary_storage_size, starting_storage) => {
        console.log(`wasm_thread_init(0x${thread.toString(16)}, ${proc}, ${temporary_storage_size}, 0x${starting_storage.toString(16)})`);
    },
    
    wasm_thread_start: (thread) => {
        console.log(`wasm_thread_start(0x${thread.toString(16)})`);
    },
    
    wasm_sound_player_backend_play: () => {
        console.log(`wasm_sound_player_backend_play()`);
    },
    
    
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

longjmp_buf: async_buf; // we unwind the stack every time we call longjmp, but we never rewind back to here

*/

const JMP_BUF_SIZE = 4096;

const JMP_BUF_STATE_INITIALIZED = 0;
const JMP_BUF_STATE_CAPTURING   = 1;
const JMP_BUF_STATE_CAPTURED    = 2;
const JMP_BUF_STATE_RETURNING   = 3;
const JMP_BUF_STATE_YIELDING    = 4;

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

let active_jmp_buf = 0n;

const jmp_buf_init = (_jmp_buf, _view) => {
    const jmp_buf = Number(_jmp_buf);
    const view = _view ?? new DataView(allocated.buffer);
    view.setBigInt64(jmp_buf + JMP_BUF_OFFSET_TOP, BigInt(jmp_buf + JMP_BUF_OFFSET_PAYLOAD), true);
    view.setBigInt64(jmp_buf + JMP_BUF_OFFSET_END, BigInt(jmp_buf + JMP_BUF_SIZE), true);
    view.setBigInt64(jmp_buf + JMP_BUF_OFFSET_UNWOUND, 0n, true);
};

const jmp_buf_note_unwound = (_jmp_buf, _view) => {
    const jmp_buf = Number(_jmp_buf);
    const view    = _view ?? new DataView(allocated.buffer);
    view.setBigInt64(
        jmp_buf + JMP_BUF_OFFSET_UNWOUND,
        view.getBigInt64(jmp_buf + JMP_BUF_OFFSET_TOP, true),
        true
    );
};

const jmp_buf_rewind = (_jmp_buf, _view) => {
    const jmp_buf = Number(_jmp_buf);
    const view    = _view ?? new DataView(allocated.buffer);
    view.setBigInt64(
        jmp_buf + JMP_BUF_OFFSET_TOP,
        view.getBigInt64(jmp_buf + JMP_BUF_OFFSET_UNWOUND, true),
        true
    );
};


// const setjmp = (jmp_buf) => {
//     throw new Error(`setjmp(0x${jmp_buf.toString(16)})`);
//     return;
// }

const setjmp = (jmp_buf) => setjmp_and_maybe_suspend(jmp_buf, false);
const setjmp_and_suspend = (jmp_buf) => setjmp_and_maybe_suspend(jmp_buf, true);
const setjmp_and_maybe_suspend = (jmp_buf, do_suspend) => {
    // jmp_buf_log_header(jmp_buf);
    const view = new DataView(allocated.buffer);
    
    
    if (active_jmp_buf !== 0n && active_jmp_buf !== jmp_buf)
        throw new Error(`unreachable? ${active_jmp_buf} ${jmp_buf}`);
        
    const state = view.getInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, true);
    if (state === JMP_BUF_STATE_INITIALIZED) {
        
        
        view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_VALUE, 0, true);
        
        if (do_suspend) {
            view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_YIELDING, true);
        } else {
            view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_CAPTURING, true);
        }
        
        active_jmp_buf = jmp_buf;
        jmp_buf_init(jmp_buf, view);
        start_unwind(jmp_buf);
        
        // This actually won't ever return if called from wasm, but will return if called from js
        // TODO: actually document all of these weird egde cases there are more
        return 0; 
    } else if (state === JMP_BUF_STATE_CAPTURING) {
        if (active_jmp_buf !== jmp_buf)
            throw new Error(`unreachable? ${active_jmp_buf} ${jmp_buf}`);
        
        view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_CAPTURED, true);
        active_jmp_buf = 0n;
        stop_rewind();
        return 0;
    } else if (state === JMP_BUF_STATE_CAPTURED) {
        throw new Error("unreachable?");
        // console.log("reuse");
        // return 0;
    } else if (state === JMP_BUF_STATE_RETURNING) {
        stop_rewind();
        if (do_suspend) {
            view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_INITIALIZED, true);
        } else {
            view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_CAPTURED, true);
        }
        active_jmp_buf = 0n;
        
        return view.getInt32(Number(jmp_buf) + JMP_BUF_OFFSET_VALUE, true);
    }
    
    // jmp_buf_log_header(setjmp_buf);
    throw new Error(`unreachable jmp_buf state ${state}`);
}

// const longjmp
// const longjmp_and_resume
// const longjmp_and_maybe_resume
const longjmp = (jmp_buf, value, no_entry_point) => {
    if (active_jmp_buf !== 0n) throw new Error(`Unreachable? ${active_jmp_buf} ${jmp_buf}`);
    if (value === 0) throw new Error("Dude do not pass 0 to longjmp what is wrong with you?");
    
    const view = new DataView(allocated.buffer);
    view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_STATE, JMP_BUF_STATE_RETURNING, true);
    view.setInt32(Number(jmp_buf) + JMP_BUF_OFFSET_VALUE, value, true);
    
    // here we unwind the stack into a dummy buffer since entry_point will rewind it back to jmp_buf
    jmp_buf_init(scratch_jmp_buf);
    start_unwind(scratch_jmp_buf);
    if (no_entry_point === undefined) {
        start_rewind(jmp_buf);
        entry_point();
    } else {
        if (active_jmp_buf !== 0n) throw new Error("unreachable");
        active_jmp_buf = jmp_buf;
    }
};

let depth = 0;
const entry_point = () => {
    depth += 1;
    while (true) {
        // console.log(`[main] ENTR entry_point ${depth} ${active_jmp_buf}`);
        jai_main(jai_context);
        // console.log(`[main] EXIT entry_point ${depth} ${active_jmp_buf}`);
        
        if (active_jmp_buf === 0n) {
            exported_js_functions.wasm_exit(0);
            depth -= 1;
            return;
        }
        
        const view  = new DataView(allocated.buffer);
        const state = view.getInt32(Number(active_jmp_buf) + JMP_BUF_OFFSET_STATE, true);
        const value = view.getInt32(Number(active_jmp_buf) + JMP_BUF_OFFSET_VALUE, true);
        
        // jmp_buf_log_header(active_jmp_buf);
        
        // console.log(`[main] active_jmp_buf in state ${state} present, rewind and re-enter main (0x${active_jmp_buf.toString(16)})`);
        if (state === 0) {
            console.log("invalid state?");
            depth -= 1;
            return;
        }
        
        
        stop_unwind();
        
        if (state === JMP_BUF_STATE_YIELDING) {
            active_jmp_buf = 0n;
            depth -= 1;
            return;
        } else if (state === JMP_BUF_STATE_CAPTURING) {
            // console.log(`[main] unwound (0x${active_jmp_buf.toString(16)})`);
            jmp_buf_note_unwound(active_jmp_buf, view);
        } else if (state === JMP_BUF_STATE_CAPTURED) {
            // console.log(`[main] rewound (0x${active_jmp_buf.toString(16)})`);
            jmp_buf_rewind(active_jmp_buf, view);
        } else if (state === JMP_BUF_STATE_RETURNING) {
            jmp_buf_rewind(active_jmp_buf, view);
        } else {
            throw `unreachable state ${state}`;
        }
        
        start_rewind(active_jmp_buf);
        
    }
};

function js_string_from_jai_string_pointer(string_pointer) {
    const offset_count = Number(string_pointer);
    const offset_data  = offset_count + 8;
    const view = new DataView(allocated.buffer);
    return js_string_from_jai_string(
        view.getBigInt64(offset_data, true),
        view.getBigInt64(offset_count, true),
    );
}

const text_decoder = new TextDecoder();
function js_string_from_jai_string(pointer, length) {
    const u8 = new Uint8Array(allocated.buffer)
    const bytes = u8.subarray(Number(pointer), Number(pointer) + Number(length));
    return text_decoder.decode(bytes);
}

function js_string_from_c_string(pointer) {
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

function write_to_console_log(str, to_standard_error) {
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
        console_timeout = setTimeout(() => {
            flush_buffer();
        }, FLUSH_CONSOLE_AFTER_MS);
    }

    function flush_buffer() {
        if (!console_buffer) return;

        if (console_buffer_is_standard_error) {
            console.error(console_buffer);
        } else {
            console.log(console_buffer);
        }

        console_buffer = "";
    }
}// One important thing to note about working with event listeners with this webassembly stuff:
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
    
    if (event.keyCode >=  0 && event.keyCode <= 90) return event.keyCode;
    
    console.log(event);
    throw new Error(`TODO convert js event.keyCode ${event.keyCode} to the jai equivalent`);
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
const fullscreen_canvas_resize_listener = (window_id, canvas) => () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    window_resizes.push({
        id: window_id,
        w: window.innerWidth, 
        h: window.innerHeight,
    });
};

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
        exported_wasm_functions.add_key_event(jai_context, it.code, it.down);
    }
    key_inputs.length = 0;
    
    for (let i = 0; i < window_resizes.length; i++) {
        const it = window_resizes[i];
        exported_wasm_functions.add_window_resize(jai_context, it.id, it.w, it.h);
    }
    window_resizes.length = 0;
};const canvases = [];
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
    canvas.width  = Number(width);
    canvas.height = Number(height);
    canvas.style.backgroundColor = `rgba(${color_r * 255}, ${color_g * 255}, ${color_b * 255}, 1)`;
    canvas.style.position = 'absolute';
    
    let transform_x;
    if (window_x === -1n) {
        canvas.style.left = '50%';
        transform_x = '-50%';
    } else {
        canvas.style.left = `${window_x}px`;
        transform_x = '0%'
    }
    
    let transform_y;
    if (window_y === -1n) {
        canvas.style.top = '50%';
        transform_y = '-50%';
    } else {
        canvas.style.top = `${window_y}px`;
        transform_y = '0%';
    }
    
    canvas.style.transform = `translate(${transform_x}, ${transform_y})`;
    
    if (parent !== -1n) throw new Error("TODO: What does that even mean in this context?");
    
    document.body.appendChild(canvas);
    canvases.push(canvas);
    const window_id = BigInt(canvases.length - 1);
    
    // This might be too much voodoo, or maybe just a good idea:
    // A lot of the example programs hard code the resolution to be bigger than your typical browser window can display at once.
    // This should be allowed since it is the equivalent of creating a window that is larger than your screen resolution, which is 
    // a valid thing to do in every operating system (why someone would do this is another question entirely...).
    // At the same time, there is a convention in the Window_Creation API that -1 for window position means to place it wherever.
    // We take that to mean that the canvas should be centered.
    
    // Now here is where the voodoo comes in; if you specify -1 for BOTH window window_x and window_y
    // we will take that to mean you don't want to think about the canvas/window stuff too hard and just
    // want the  canvas to be the full browser window. That way both examples that don't use multiple windows and position them
    // explicitly and programs that are just a single window both behave as you would expect.
    
    // The one edge case I can think of here is a situation where you are using Simp but not Input, and in that case you can call
    // Simp.get_render_dimensions explicitly anyway
    
    // An alterantive solution would be to implement a proper window manager in HTML/CSS/JS so that the user can resize the canvas like
    // they can in other OSes, which would be pretty cool thing to try and implement and a great excercise for whoever is reading this ;]
    
    // -nzizic, 2 May 2025
    
    if (window_x === -1n && window_y === -1n) {
        canvas.width  = window.innerWidth;
        canvas.height = window.innerHeight;
        const add_resize = exported_wasm_functions.add_window_resize;
        if (add_resize !== undefined) add_resize(jai_context, window_id, canvas.width, canvas.height);
        
        if (fullscreen_canvas_resize_listener !== undefined) {
            window.addEventListener("resize", fullscreen_canvas_resize_listener(window_id, canvas));
        }
    }
    
    
    return window_id;
};

exported_js_functions.wasm_get_mouse_pointer_position = (window_id, right_handed, x_ptr, y_ptr) => {
    const canvas = get_canvas(window_id);
    const rect = canvas.getBoundingClientRect();
    
    
    const x = BigInt(Math.floor(0.5 + mouse_position_x - rect.left));
    const y = (right_handed !== 0)
        ? BigInt(Math.floor(0.5 + rect.bottom - (window.innerHeight * (mouse_position_y / window.innerHeight))))
        : BigInt(Math.floor(0.5 + mouse_position_y - rect.top));
    
    const view = new DataView(allocated.buffer);
    view.setBigInt64(Number(x_ptr), x, true);
    view.setBigInt64(Number(y_ptr), y, true);
};

exported_js_functions.wasm_get_render_dimensions = (window, width_ptr, height_ptr) => {
    const canvas = get_canvas(window);
    const view = new DataView(allocated.buffer);
    view.setInt32(Number(width_ptr), canvas.width, true);  // Write width
    view.setInt32(Number(height_ptr), canvas.height, true); // Write height
};

exported_js_functions.wasm_get_dimensions = (window, right_handed, x_ptr, y_ptr, width_ptr, height_ptr) => {
    // if (right_handed !== 0) throw "TODO wasm_get_dimensions right_handed";
    
    const canvas = get_canvas(window);
    const view = new DataView(allocated.buffer);
    
    // TODO: css absolute position stuff??
    view.setInt32(Number(x_ptr), 0, true);
    view.setInt32(Number(y_ptr), 0, true);
    view.setInt32(Number(width_ptr), canvas.width, true);  // Write width
    view.setInt32(Number(height_ptr), canvas.height, true); // Write height
};
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

exported_js_functions.wasm_read_entire_file = (file, zero_terminated, out_content, out_success) => {
    if (setjmp_and_suspend(yield_jmp_buf) === 0) {
        files[file].then((buffer) => {
            files[file] = new Uint8Array(buffer);
            longjmp(yield_jmp_buf, 1);
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
const time_origin = Date.now();
exported_js_functions.wasm_get_microseconds = () => { return BigInt((Number(time_origin) + Number(performance.now())) * 1000); };

exported_js_functions.wasm_sleep_milliseconds = (ms) => {
    if (setjmp_and_suspend(yield_jmp_buf) === 0)
        setTimeout(() => { longjmp(yield_jmp_buf, 1); }, ms);
};
let front_canvas = undefined;
const back_canvas = new OffscreenCanvas(0, 0);
const gl = back_canvas.getContext("webgl2");
if (!gl ||
    !gl.getExtension("EXT_texture_filter_anisotropic")
) throw new Error("Browser does not support WebGL!");

const gl_handles = []; // this stores both shader components and programs
const gl_handle_put = (obj) => {
    gl_handles.push(obj);
    return gl_handles.length;
};
const gl_handle_get = (handle) => {
    const index = handle - 1; // since many gl procedures use an ID of 0 as a sentinel
    const obj   = gl_handles[index];
    
    if (!obj) throw new Error(`Handle ${handle} does not refer to a valid opengl object`);
    return obj;
};


exported_js_functions.wasm_gl_set_render_target = (window) => {
    front_canvas = get_canvas(window);
    back_canvas.width  = front_canvas.width;
    back_canvas.height = front_canvas.height;
};

// TODO: maybe don't requestAnimationFrame?
exported_js_functions.wasm_webgl_swap_buffers = (window, vsync) => {
    if (setjmp_and_suspend(yield_jmp_buf) === 0) {
        requestAnimationFrame(() => {
            exported_js_functions.wasm_gl_set_render_target(window);
            front_canvas.getContext("2d").drawImage(back_canvas, 0, 0, front_canvas.width, front_canvas.height);
            longjmp(yield_jmp_buf, 1);
        });
    }
};

exported_js_functions.glViewport = (x, y, width, height) => { gl.viewport(x, y, width, height); };
exported_js_functions.glScissor = (x, y, width, height) => { gl.scissor(x, y, width, height); };
exported_js_functions.glCreateProgram = () => { return gl_handle_put(gl.createProgram()); };
exported_js_functions.glAttachShader = (program, shader) => { gl.attachShader(gl_handle_get(program), gl_handle_get(shader)); };
exported_js_functions.glLinkProgram = (program) => { gl.linkProgram(gl_handle_get(program)); };
exported_js_functions.glDeleteShader = (shader) => { gl.deleteShader(gl_handle_get(shader)); };
exported_js_functions.glBindTexture = (target, texture) => { gl.bindTexture(target, gl_handle_get(texture)); };
exported_js_functions.glClearColor = (r, g, b, a) => { gl.clearColor(r, g, b, a); };
exported_js_functions.glClear = (mask) => { gl.clear(mask); };
exported_js_functions.glDepthMask = (flag) => { gl.depthMask(flag); };
exported_js_functions.glDisable = (cap) => { gl.disable(cap); };
exported_js_functions.glUseProgram = (program) => { gl.useProgram(gl_handle_get(program)); };
exported_js_functions.glUniformBlockBinding = (program, index, binding) => { gl.uniformBlockBinding(gl_handle_get(program), index, binding); };
exported_js_functions.glUniform1i = (loc, v) => { gl.uniform1i(gl_handle_get(loc), v); };
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

exported_js_functions.glGenVertexArrays = (n, arrays) => {
    const view = new DataView(allocated.buffer);
    for (let i = 0; i < n; i++) {
        const handle = gl_handle_put(gl.createVertexArray());
        view.setUint32(Number(arrays) + i * 4, handle, true);
    }
};

exported_js_functions.glGenBuffers = (n, buffers) => {
    const view = new DataView(allocated.buffer);
    for (let i = 0; i < n; i++) {
        const handle = gl_handle_put(gl.createBuffer());
        view.setUint32(Number(buffers) + i * 4, handle, true);
    }
};

exported_js_functions.glGenTextures = (n, buffers) => {
    const view = new DataView(allocated.buffer);
    for (let i = 0; i < n; i++) {
        const handle = gl_handle_put(gl.createTexture());
        view.setUint32(Number(buffers) + i * 4, handle, true);
    }
};

exported_js_functions.glCreateShader = (typ) => {
    return gl_handle_put(gl.createShader(typ));
};

exported_js_functions.glShaderSource = (_shader, count, strings_data, lengths_data) => {
    const shader = gl_handle_get(_shader);
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

exported_js_functions.glCompileShader = (_shader) => {
    gl.compileShader(gl_handle_get(_shader));
};

exported_js_functions.glGetIntegerv = (pname, data) => {
    const result = gl.getParameter(pname)
    new DataView(allocated.buffer).setInt32(Number(data), result, true);
};

exported_js_functions.glGetShaderiv = (_shader, pname, params_ptr) => {
    const shader = gl_handle_get(_shader);
    const result = gl.getShaderParameter(shader, pname);
    const view = new DataView(allocated.buffer);
    view.setInt32(Number(params_ptr), result, true);
};

exported_js_functions.glGetShaderInfoLog = (_shader, length_ptr, data_ptr) => {
    gl = gl;
    const shader = gl_handle_get(_shader);
    const info = gl.getShaderInfoLog(shader);
    throw `TODO: copy jai_string_from_js_string from fugue \n\n${info}`;
};

exported_js_functions.glGetProgramiv = (_shader, pname, params_ptr) => {
    const shader = gl_handle_get(_shader);
    const result = gl.getProgramParameter(shader, pname);
    const view = new DataView(allocated.buffer);
    view.setInt32(Number(params_ptr), result, true);
};


exported_js_functions.glBindFramebuffer = (target, _buffer) => {
    let buffer = null;
    if (_buffer !== 0) buffer = gl_handle_get(_buffer);
    gl.bindFramebuffer(target, buffer); 
};

exported_js_functions.glGetAttribLocation = (_program, _name) => {
    const program = gl_handle_get(_program);
    const name = js_string_from_c_string(_name);
    return gl.getAttribLocation(program, name);
};

exported_js_functions.glGetUniformLocation = (_program, _name) => {
    const program = gl_handle_get(_program);
    const name = js_string_from_c_string(_name);
    return gl_handle_put(gl.getUniformLocation(program, name));
};

exported_js_functions.glGetUniformBlockIndex = (_program, _name) => {
    const program = gl_handle_get(_program);
    const name = js_string_from_c_string(_name);
    const [ index ] = gl.getUniformIndices(program, [ name ]);
    return index;
};

exported_js_functions.glUniformMatrix4fv = (_location, count, transpose, value_ptr) => {
    if (count !== 1) throw "TODO: handle packed array of matrices";
    const location = gl_handle_get(_location);
    const value = new Float32Array(allocated.buffer, Number(value_ptr), 16);
    gl.uniformMatrix4fv(location, transpose, value);
};

exported_js_functions.glBindVertexArray = (_array) => {
    const array = (_array === 0) ? null : gl_handle_get(_array);
    gl.bindVertexArray(array);
};

exported_js_functions.glBindBuffer = (target, _buffer) => {
    const buffer = (_buffer === 0) ? null : gl_handle_get(_buffer);
    gl.bindBuffer(target, buffer);
};

exported_js_functions.glBindBufferBase = (target, index, buffer) => { gl.bindBufferBase(target, index, gl_handle_get(buffer)); };

exported_js_functions.glBufferData = (target, size, _data, usage) => {
    const data = (_data === 0n) ? Number(size) : new DataView(allocated.buffer, Number(_data), Number(size));
    gl.bufferData(target, data, usage);
};

exported_js_functions.glBufferSubData = (target, offset, size, _data) => {
    const data = new DataView(allocated.buffer, Number(_data), Number(size));
    gl.bufferSubData(target, Number(offset), data);
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
    } else throw `TODO: Unsupported texturee element type ${typ}`;
    
    const data = new Uint8Array(allocated.buffer, Number(pixels), width*height*components*element_size);
    gl.texImage2D(target, level, internalformat, width, height, border, format, typ, data);
};


let exported_wasm_functions;
let allocated; // A global reference of the WASM’s memory area so that we can look up pointersj
let jai_context;

let jai_main;
let jai_alloc;
let jai_free;


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
        
        yield_jmp_buf = exported_wasm_functions.get_yield_jmp_buf();
        jmp_buf_init(yield_jmp_buf);
        
        scratch_jmp_buf = exported_wasm_functions.get_scratch_jmp_buf();
        jmp_buf_init(scratch_jmp_buf);
        
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
// TODO: should probably have some forntend stuff that tells the user to click on the window to start or whatever
window.addEventListener("click", start_wasm_listner);
create_fullscreen_canvas("Click to Start");

