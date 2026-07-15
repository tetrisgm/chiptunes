#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

#include <memory>
#include <napi.h>

namespace {

struct PowerState {
  bool low_power_mode;
  bool screens_sleeping;
};

std::unique_ptr<Napi::ThreadSafeFunction> power_callback;
id screens_sleep_observer = nil;
id screens_wake_observer = nil;
id low_power_observer = nil;
bool screens_sleeping = false;

std::unique_ptr<Napi::ThreadSafeFunction> occlusion_callback;
id occlusion_observer = nil;

struct OcclusionEvent {
  long window_number;
  bool visible;
};

NSView* ViewFromHandle(const Napi::Value& value) {
  if (!value.IsBuffer()) return nil;
  Napi::Buffer<uint8_t> buffer = value.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) return nil;
  void* pointer = *reinterpret_cast<void**>(buffer.Data());
  return (__bridge NSView*)pointer;
}

Napi::Object PowerStateObject(Napi::Env env, const PowerState& state) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("lowPowerMode", Napi::Boolean::New(env, state.low_power_mode));
  result.Set("screensSleeping", Napi::Boolean::New(env, state.screens_sleeping));
  return result;
}

PowerState CurrentPowerState() {
  return {
    [[NSProcessInfo processInfo] isLowPowerModeEnabled] == YES,
    screens_sleeping,
  };
}

void EmitPowerState() {
  if (!power_callback) return;
  PowerState* state = new PowerState(CurrentPowerState());
  napi_status status = power_callback->NonBlockingCall(
    state,
    [](Napi::Env env, Napi::Function callback, PowerState* value) {
      callback.Call({PowerStateObject(env, *value)});
      delete value;
    }
  );
  if (status != napi_ok) delete state;
}

void RemovePowerObservers() {
  NSNotificationCenter* workspace_center = [[NSWorkspace sharedWorkspace] notificationCenter];
  NSNotificationCenter* default_center = [NSNotificationCenter defaultCenter];
  if (screens_sleep_observer) [workspace_center removeObserver:screens_sleep_observer];
  if (screens_wake_observer) [workspace_center removeObserver:screens_wake_observer];
  if (low_power_observer) [default_center removeObserver:low_power_observer];
  screens_sleep_observer = nil;
  screens_wake_observer = nil;
  low_power_observer = nil;
}

Napi::Value AttachWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSView* view = info.Length() > 0 ? ViewFromHandle(info[0]) : nil;
  NSWindow* window = view.window;
  if (!window) {
    Napi::TypeError::New(env, "Expected an Electron NSView handle attached to an NSWindow")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const CGWindowLevel desktop_level = CGWindowLevelForKey(kCGDesktopWindowLevelKey);
  const CGWindowLevel icon_level = CGWindowLevelForKey(kCGDesktopIconWindowLevelKey);
  window.level = desktop_level;
  window.collectionBehavior = (
    NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorStationary |
    NSWindowCollectionBehaviorIgnoresCycle |
    NSWindowCollectionBehaviorFullScreenNone
  );
  window.ignoresMouseEvents = YES;
  window.hasShadow = NO;
  window.movable = NO;
  window.restorable = NO;
  window.hidesOnDeactivate = NO;
  window.excludedFromWindowsMenu = YES;
  [window orderFrontRegardless];

  Napi::Object result = Napi::Object::New(env);
  result.Set("windowNumber", Napi::Number::New(env, window.windowNumber));
  result.Set("level", Napi::Number::New(env, window.level));
  result.Set("desktopLevel", Napi::Number::New(env, desktop_level));
  result.Set("desktopIconLevel", Napi::Number::New(env, icon_level));
  result.Set("ignoresMouseEvents", Napi::Boolean::New(env, window.ignoresMouseEvents));
  result.Set("collectionBehavior", Napi::Number::New(env, window.collectionBehavior));
  return result;
}

Napi::Value WindowInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSView* view = info.Length() > 0 ? ViewFromHandle(info[0]) : nil;
  NSWindow* window = view.window;
  if (!window) return env.Null();

  Napi::Object result = Napi::Object::New(env);
  result.Set("windowNumber", Napi::Number::New(env, window.windowNumber));
  result.Set("level", Napi::Number::New(env, window.level));
  result.Set("ignoresMouseEvents", Napi::Boolean::New(env, window.ignoresMouseEvents));
  result.Set("collectionBehavior", Napi::Number::New(env, window.collectionBehavior));
  return result;
}

Napi::Value DesktopLevels(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  result.Set("desktop", Napi::Number::New(env, CGWindowLevelForKey(kCGDesktopWindowLevelKey)));
  result.Set("desktopIcon", Napi::Number::New(env, CGWindowLevelForKey(kCGDesktopIconWindowLevelKey)));
  result.Set("normal", Napi::Number::New(env, CGWindowLevelForKey(kCGNormalWindowLevelKey)));
  return result;
}

Napi::Value GetPowerState(const Napi::CallbackInfo& info) {
  return PowerStateObject(info.Env(), CurrentPowerState());
}

Napi::Value StopPowerMonitor(const Napi::CallbackInfo& info) {
  RemovePowerObservers();
  if (power_callback) {
    power_callback->Release();
    power_callback.reset();
  }
  return info.Env().Undefined();
}

Napi::Value StartPowerMonitor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a power-state callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  RemovePowerObservers();
  if (power_callback) {
    power_callback->Release();
    power_callback.reset();
  }
  power_callback = std::make_unique<Napi::ThreadSafeFunction>(
    Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "RRR macOS power state", 0, 1)
  );

  NSNotificationCenter* workspace_center = [[NSWorkspace sharedWorkspace] notificationCenter];
  screens_sleep_observer = [workspace_center
    addObserverForName:NSWorkspaceScreensDidSleepNotification
    object:nil
    queue:nil
    usingBlock:^(__unused NSNotification* notification) {
      screens_sleeping = true;
      EmitPowerState();
    }];
  screens_wake_observer = [workspace_center
    addObserverForName:NSWorkspaceScreensDidWakeNotification
    object:nil
    queue:nil
    usingBlock:^(__unused NSNotification* notification) {
      screens_sleeping = false;
      EmitPowerState();
    }];
  low_power_observer = [[NSNotificationCenter defaultCenter]
    addObserverForName:NSProcessInfoPowerStateDidChangeNotification
    object:nil
    queue:nil
    usingBlock:^(__unused NSNotification* notification) {
      EmitPowerState();
    }];

  return PowerStateObject(env, CurrentPowerState());
}

Napi::Object OcclusionEventObject(Napi::Env env, const OcclusionEvent& event) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("windowNumber", Napi::Number::New(env, static_cast<double>(event.window_number)));
  result.Set("visible", Napi::Boolean::New(env, event.visible));
  return result;
}

void EmitOcclusion(long window_number, bool visible) {
  if (!occlusion_callback) return;
  OcclusionEvent* event = new OcclusionEvent{window_number, visible};
  napi_status status = occlusion_callback->NonBlockingCall(
    event,
    [](Napi::Env env, Napi::Function callback, OcclusionEvent* value) {
      callback.Call({OcclusionEventObject(env, *value)});
      delete value;
    }
  );
  if (status != napi_ok) delete event;
}

void RemoveOcclusionObserver() {
  if (occlusion_observer) {
    [[NSNotificationCenter defaultCenter] removeObserver:occlusion_observer];
    occlusion_observer = nil;
  }
}

// Observe NSWindow occlusion for ALL of this app's windows (object:nil); the JS side maps the
// windowNumber back to a wallpaper window and ignores any it doesn't own. macOS does NOT auto-throttle
// WebGL windows on occlusion, so this is how the render loop learns it is fully covered.
Napi::Value StartOcclusionMonitor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected an occlusion-state callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  RemoveOcclusionObserver();
  if (occlusion_callback) {
    occlusion_callback->Release();
    occlusion_callback.reset();
  }
  occlusion_callback = std::make_unique<Napi::ThreadSafeFunction>(
    Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "RRR macOS occlusion state", 0, 1)
  );

  occlusion_observer = [[NSNotificationCenter defaultCenter]
    addObserverForName:NSWindowDidChangeOcclusionStateNotification
    object:nil
    queue:nil
    usingBlock:^(NSNotification* notification) {
      id object = notification.object;
      if (![object isKindOfClass:[NSWindow class]]) return;
      NSWindow* window = (NSWindow*)object;
      bool visible = (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
      EmitOcclusion(static_cast<long>(window.windowNumber), visible);
    }];

  return env.Undefined();
}

Napi::Value StopOcclusionMonitor(const Napi::CallbackInfo& info) {
  RemoveOcclusionObserver();
  if (occlusion_callback) {
    occlusion_callback->Release();
    occlusion_callback.reset();
  }
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("attachWindow", Napi::Function::New(env, AttachWindow));
  exports.Set("getWindowInfo", Napi::Function::New(env, WindowInfo));
  exports.Set("getDesktopLevels", Napi::Function::New(env, DesktopLevels));
  exports.Set("getPowerState", Napi::Function::New(env, GetPowerState));
  exports.Set("startPowerMonitor", Napi::Function::New(env, StartPowerMonitor));
  exports.Set("stopPowerMonitor", Napi::Function::New(env, StopPowerMonitor));
  exports.Set("startOcclusionMonitor", Napi::Function::New(env, StartOcclusionMonitor));
  exports.Set("stopOcclusionMonitor", Napi::Function::New(env, StopOcclusionMonitor));
  return exports;
}

}  // namespace

NODE_API_MODULE(rrr_wallpaper, Init)
