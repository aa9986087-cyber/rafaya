import subprocess, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
def run(*a): subprocess.run(["ffmpeg","-loglevel","error","-y",*a],check=True)
def dur(f): return float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f],capture_output=True,text=True).stdout)
E=["-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-r","30","-an"]
def game(name, d, start=0, speed=1.0, extra=""):
    vf=f"setpts=PTS/{speed},fps=30" + (","+extra if extra else "")
    run("-framerate","30","-start_number",str(start),"-i",f"modern/{name}/f%04d.jpg","-t",str(d),"-vf",vf,*E,f"v_{name}.mp4"); return f"v_{name}.mp4"
def anc(name, s0, s1, extra=""):
    vf="fps=30" + (","+extra if extra else "")
    run("-framerate","24","-start_number",str(int(s0*24)),"-i","framesv/f%05d.jpg","-t",str(s1-s0),"-vf",vf,*E,f"a_{name}.mp4"); return f"a_{name}.mp4"
def bat(name, s0, s1, extra=""):
    vf="fps=30" + (","+extra if extra else "")
    run("-framerate","24","-start_number",str(int(round(s0*24))),"-i","framesb/f%05d.jpg","-t",str(s1-s0),"-vf",vf,*E,f"b_{name}.mp4"); return f"b_{name}.mp4"
segs=[]; names=[]
def add(n, f): names.append(n); segs.append(f)
add("m1", game("m1",3.5,0,0.8,"fade=t=in:st=0:d=0.8"))
add("m6", game("m6",3.0,0,0.9))
add("m4", game("m4",4.0,40,1.0))
add("m3", game("m3",3.0,0,0.8))
add("gnight", anc("gnight",1.5,4.5,"fade=t=in:st=0:d=0.5"))
add("gstar", anc("gstar",8.5,12))
add("gstorm", anc("gstorm",17.6,21.8))
add("m8", game("m8",5.9,1,1.0,"fade=t=in:st=0:d=0.6:color=white,fade=t=out:st=5.0:d=0.9:color=white"))
add("aerial", anc("aerial",22,26.5,"fade=t=in:st=0:d=1:color=white"))
add("sword", anc("sword",36,39.5))
add("B1", bat("B1",0,4.6)); add("B2", bat("B2",4.6,8.6)); add("B3", bat("B3",8.6,12.6)); add("B4", bat("B4",12.6,16.2)); add("B5", bat("B5",16.2,20.4)); add("B6", bat("B6",20.4,25))
add("title", anc("title",63.5,70))
starts=[]; t=0
for s_ in segs: starts.append(t); t+=dur(s_)
print("starts", [round(x,2) for x in starts], "total", round(t,2))
open("list5.txt","w").write("".join(f"file '{s_}'\n" for s_ in segs))
run("-f","concat","-safe","0","-i","list5.txt","-c","copy","video5.mp4")
total=t
st=dict(zip(names,starts))
cues=[("a1",st["m1"]+0.6),("a3",st["m4"]+0.4),("a4",st["gnight"]-0.2),("b1",st["gstar"]+1.6),("r1",st["m8"]+0.9),("b5",st["aerial"]+0.6),("b6",st["sword"]+0.3),
      ("w1",st["B2"]+0.3),("b8",st["B5"]+0.3),("b9",st["B6"]+2.0)]
run("-ss","17","-t",f"{st['m8']:.2f}","-i","music/score2.mp3","-ss","66.5","-i","music/score2.mp3",
    "-filter_complex","[0][1]acrossfade=d=0.6:c1=tri:c2=tri[m]","-map","[m]","-c:a","pcm_s16le","music_full.wav")
ins=[]; fl=[]; vo=[]; fx=[]
def inp(path): ins.extend(["-i",path]); return len(ins)//2-1
m=inp("music_full.wav"); fl.append(f"[{m}]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.45,atrim=0:{total:.2f},afade=t=out:st={total-3:.2f}:d=3[mus]")
def sfx(path,start,vol,extra=""):
    i=inp(path); ms=int(start*1000); fl.append(f"[{i}]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol}{extra},adelay={ms}|{ms}[f{i}]"); fx.append(f"[f{i}]")
sfx("sfx/city.mp3",0,0.16,",afade=t=in:d=1.5,afade=t=out:st=5:d=2")
sfx("sfx/launch.mp3",st["m4"]+0.8,0.32)
sfx("sfx/night.mp3",st["gnight"],0.22,",afade=t=in:d=1,afade=t=out:st=6:d=1")
sfx("sfx/storm.mp3",st["gstorm"],0.3,",afade=t=in:d=1,afade=t=out:st=4:d=1")
sfx("sfx/gate.mp3",st["gstorm"]+0.9,0.38)
sfx("sfx/riser.mp3",st["m8"]+0.8,0.32)
sfx("sfx/hit.mp3",st["aerial"]-0.15,0.38)
sfx("sfx/dawn.mp3",st["aerial"],0.15,",afade=t=in:d=1.5,afade=t=out:st=6:d=2")
sfx("sfx2/march.mp3",st["B1"],0.32,",afade=t=in:d=0.8,afade=t=out:st=4:d=0.8")
sfx("sfx2/gallop.mp3",st["B2"],0.42,",afade=t=out:st=4.2:d=0.8")
sfx("sfx2/cries.mp3",st["B2"]-0.4,0.26,",afade=t=in:d=0.6")
sfx("sfx2/arrows.mp3",st["B3"]+1.1,0.42)
sfx("sfx2/arrows.mp3",st["B3"]+3.0,0.36)
sfx("sfx2/arrows.mp3",st["B4"]+0.2,0.36)
sfx("sfx2/ram.mp3",st["B5"],0.48)
sfx("sfx2/fire.mp3",st["B5"],0.26,",afade=t=out:st=5:d=1")
sfx("sfx2/cries.mp3",st["B6"],0.22,",afade=t=out:st=4:d=1")
sfx("sfx/hit.mp3",st["title"]+0.6,0.3)
for k,t in cues:
    i=inp(f"vo/{k}.mp3"); ms=int(t*1000)
    fl.append(f"[{i}]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=80,acompressor=threshold=0.1:ratio=3:attack=5:release=120,volume=2.2,adelay={ms}|{ms}[v{i}]"); vo.append(f"[v{i}]")
fl.append(f"{''.join(vo)}amix=inputs={len(vo)}:normalize=0,apad[vo]")
fl.append("[vo]asplit=2[vo1][vo2]")
fl.append(f"{''.join(fx)}amix=inputs={len(fx)}:normalize=0,apad[fxs]")
fl.append("[fxs][mus]amix=inputs=2:normalize=0[bed]")
fl.append("[bed][vo1]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350:makeup=1[duck]")
fl.append(f"[duck][vo2]amix=inputs=2:normalize=0:duration=first,atrim=0:{total:.2f},loudnorm=I=-14:TP=-1.5:LRA=9[a]")
run(*ins,"-filter_complex",";".join(fl),"-map","[a]","-c:a","aac","-b:a","256k","-ar","48000","mix5.m4a")
# ---- subtitles ----
vins=["-i","video5.mp4"]; vf=[]; last="[0:v]"
for n,(k,t) in enumerate(cues,1):
    d=dur(f"vo/{k}.mp3")+0.5
    vins+=["-loop","1","-t",f"{d:.2f}","-i",f"subs/{k}.png"]
    vf.append(f"[{n}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st={d-0.4:.2f}:d=0.4:alpha=1,setpts=PTS+{t:.2f}/TB[s{n}]")
    vf.append(f"{last}[s{n}]overlay=0:930:eof_action=pass:enable='between(t,{t:.2f},{t+d:.2f})'[o{n}]"); last=f"[o{n}]"
run(*vins,"-i","mix5.m4a","-filter_complex",";".join(vf),"-map",last,"-map",f"{len(cues)+1}:a","-t",f"{total:.2f}","-c:v","libx264","-crf","21","-preset","medium","-pix_fmt","yuv420p","-c:a","copy","-movflags","+faststart","jouf-trailer-v5.mp4")
print("done", total)
